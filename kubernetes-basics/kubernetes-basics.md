---
title: Kubernetes Basics Explained - Architecture, Workloads, Networking and Deployments
date: 2026-11-21
summary: A practical introduction to Kubernetes covering cluster architecture, core objects, Services and Ingress, storage, scaling, RBAC, and how a Deployment is applied and rolled out.
tag: kubernetes, containers, devops, orchestration, docker
draft: false
related: how-docker-works-internally,kubernetes-interview-questions,microservices-vs-monolithic-architecture,load-balancing-explained,how-dns-works
---

**Kubernetes** is an open-source system for automating the deployment, scaling, and management of containerized applications across a cluster of machines. You describe the workload you want (how many replicas, which image, which ports, how much CPU) as objects in the Kubernetes API. The cluster continuously compares that **desired state** with what is actually running and works to close the gap.

The project grew out of Google's experience running containers at scale with internal systems named **Borg** and **Omega**. Kubernetes was open-sourced in 2014 (the first public commit landed on 6 June 2014, and the project was announced shortly after). It reached **1.0** on 21 July 2015, and at that release Google announced that Kubernetes would be donated to the newly formed **Cloud Native Computing Foundation (CNCF)**. As of November 2026, the project maintains the three most recent minor releases, and **1.37** is the latest stable minor line.

This article is a working introduction: why Kubernetes exists, how the cluster fits together, the objects you use every day, and what happens when you apply a Deployment, including a simple Spring Boot example.

## Why Kubernetes Exists

A container packages an application and its runtime so it can start the same way on a laptop or a server. That solves "it works on my machine" for a single process. It does not decide *where* the process should run, how many copies you need, what happens when a machine dies, how those copies find each other, or how you roll out a new image without dropping every request.

Without an orchestrator, those jobs fall to scripts or an ad-hoc service manager. That gets brittle as soon as you have more than a handful of services:

- A node fails, and the containers on it do not come back elsewhere on their own.
- You want three replicas, then five, then back to three, without rewriting start scripts.
- You need a stable way for other services to reach a set of changing container IPs.
- You want a rolling update, and a way to undo it.

Kubernetes is a **container orchestrator**. It schedules containers onto nodes, restarts them, exposes them on a stable network identity, and updates them according to objects you store in the API. It does not build your images (you still use Docker or another build tool for that) and it does not replace your application architecture.

## The Declarative Model

Kubernetes is **declarative**. You do not usually tell the cluster "start container A on node 4." You submit an object that says "I want three replicas of this Pod template, behind this Service," and you leave it in the API. **Controllers** watch those objects, compare desired state with the live cluster, and take actions (create a Pod, attach a volume, update an EndpointSlice) until they match.

That loop is called **reconciliation**. It runs continuously, not only at apply time. If a node disappears, or if someone deletes a Pod by hand, the Deployment controller notices that the replica count is short and creates a replacement. If you raise the desired count from three to five, the same controller adds two Pods.

```
desired state (API objects)
        |
        v
  controllers reconcile  ---->  create / update / delete
        ^
        |
actual state (Pods, nodes, volumes)
```

The source of truth is the API, persisted in **etcd**. `kubectl` and controllers are all clients of that API. This is also why YAML manifests matter: they are a convenient way to express API objects, not a special language the nodes themselves execute.

## Cluster Architecture

A cluster has a **control plane** and one or more **nodes**. In managed clusters the control plane may be a service you never SSH into, but the roles stay the same.

```
                    Control plane
          +----------------------------------+
          |  kube-apiserver                  |
          |       |                          |
          |     etcd                         |
          |  kube-scheduler                  |
          |  kube-controller-manager         |
          |  cloud-controller-manager (opt.) |
          +----------------+-----------------+
                           | API
           +---------------+----------------+
           |                                |
      Node A                            Node B
  kubelet, kube-proxy               kubelet, kube-proxy
  container runtime (CRI)           container runtime (CRI)
  Pods                              Pods
```

### The Control Plane

- **`kube-apiserver`** is the front door. All cluster state is read and written through it. It authenticates and authorizes requests, validates objects, and stores them.
- **`etcd`** is the consistent key-value store that holds cluster state. If etcd is lost and not backed up, the control plane has no memory of what should be running.
- **`kube-scheduler`** watches for Pods that have not been assigned a node, then binds each one to a node that satisfies its constraints (CPU and memory requests, affinity, taints and tolerations, and so on).
- **`kube-controller-manager`** runs the built-in controllers: Deployment, ReplicaSet, Job, EndpointSlice, Namespace, ServiceAccount, and many others. Each is a reconciliation loop.
- **`cloud-controller-manager`** is optional. It holds cloud-specific loops such as attaching load balancers, or identifying nodes that the cloud provider has deleted, so those concerns do not have to live inside the generic controller manager.

Clients never talk to etcd or the scheduler directly. They talk to the API server, usually with `kubectl` and a kubeconfig file that holds the cluster address and credentials.

### Nodes

A **node** is a machine (virtual or physical) that runs Pods.

- **`kubelet`** is the agent on the node. It registers the node, watches the API for Pods scheduled to it, and asks the container runtime to start and stop containers. It also reports node and Pod status, and runs probes.
- **`kube-proxy`** implements Service networking on the node. It programs packet rules so that traffic to a Service IP or NodePort reaches a healthy backing Pod.
- The **container runtime** pulls images and runs containers. The kubelet talks to it through the **Container Runtime Interface (CRI)**. **containerd** is a common runtime on current clusters. **CRI-O** is another CRI implementation.

### Container Runtimes and the End of Dockershim

Early Kubernetes spoke to **Docker Engine** through a built-in adapter called **dockershim**. The CRI later made runtimes interchangeable. Dockershim was deprecated in 1.20 and **removed in Kubernetes 1.24**. From 1.24 onward, the kubelet needs a CRI-compatible runtime such as containerd or CRI-O. If you still want Docker Engine as the runtime, you use an external adapter such as `cri-dockerd`.

You can still *build* images with Docker. Those images run on containerd and other CRI runtimes. What went away is the in-tree shim that made Docker Engine look like a CRI runtime to the kubelet.

## Pods

A **Pod** is the smallest deployable unit. It wraps one or more containers that share a network namespace (one Pod IP, a shared port space) and may share volumes. Containers in the same Pod can talk to each other on `localhost`. Most Pods have a single application container; a second container is typically a sidecar for logs, a proxy, or a helper. You rarely create bare Pods for long-running applications. A Deployment or similar controller owns them so they can be replaced.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: shop-api-manual
  labels:
    app: shop-api
spec:
  containers:
    - name: shop-api
      image: ghcr.io/example/shop-api:1.0
      ports:
        - containerPort: 8080
```

If this Pod dies and nothing owns it, it is not recreated. That is why controllers exist.

## Labels and Selectors

**Labels** are key-value tags on objects (`app: shop-api`, `tier: backend`). **Selectors** ask for objects with those labels. Services find Pods by selector. Deployments find their ReplicaSets and Pods the same way. Controllers add their own labels (such as a unique Pod-template hash) so they do not adopt the wrong Pods.

Labels are for identification and grouping, not a security boundary. Anyone who can create a Service in a namespace can select Pods there if they know the labels, subject to RBAC.

## ReplicaSets and Deployments

A **ReplicaSet** keeps a stable number of Pods for a given template. If you ask for three and one dies, it creates another.

A **Deployment** is what you usually write. It owns ReplicaSets and adds rollouts. When you change the Pod template (a new image, a new env var), the Deployment creates a new ReplicaSet and performs a **rolling update**: new Pods come up, old Pods go down, according to `maxUnavailable` and `maxSurge`. You can **roll back** to a previous revision.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
  labels:
    app: shop-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: shop-api
  template:
    metadata:
      labels:
        app: shop-api
    spec:
      containers:
        - name: shop-api
          image: ghcr.io/example/shop-api:1.0
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
```

Useful rollout commands:

```bash
kubectl rollout status deployment/shop-api
kubectl rollout history deployment/shop-api
kubectl rollout undo deployment/shop-api
kubectl rollout undo deployment/shop-api --to-revision=2
```

Do not hand-edit Pods that a Deployment owns. The controller will overwrite or replace them to match the template.

## Services

A **Service** gives a stable identity to a set of Pods. Pod IPs change as Pods are replaced. A Service has a virtual **cluster IP** (for the default type) and a DNS name of the form `shop-api.default.svc.cluster.local` (or a shorter name inside the same namespace). kube-proxy and EndpointSlices steer traffic to Pods that match the selector and pass readiness checks.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: shop-api
spec:
  selector:
    app: shop-api
  ports:
    - name: http
      port: 80
      targetPort: 8080
  type: ClusterIP
```

Common `type` values:

| Type | Reachability |
| --- | --- |
| `ClusterIP` (default) | Stable IP only inside the cluster |
| `NodePort` | ClusterIP plus a port on every node, for access from outside in simple setups |
| `LoadBalancer` | Also asks a cloud provider (or an equivalent controller) to provision an external load balancer |
| Headless (`clusterIP: None`) | No virtual IP; DNS returns Pod IPs, used by StatefulSets and some clients that need to talk to each instance |

If no Pods match, the Service still exists, but it has no backends. `NodePort` and `LoadBalancer` are about how traffic enters the cluster, not about replacing Deployments.

## Ingress and Gateway API

A Service of type `LoadBalancer` can expose one application. **Ingress** describes HTTP and HTTPS routing from outside the cluster to Services, usually by host and path. An **Ingress controller** (NGINX, a cloud load balancer controller, or similar) implements the object. Without a controller, an Ingress object does nothing.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
spec:
  ingressClassName: nginx
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: shop-api
                port:
                  number: 80
```

Ingress has been stable since Kubernetes 1.19. The official documentation now states that the **Ingress API is frozen**: it remains generally available and is not planned for removal, but it will not gain new features. The project **recommends Gateway API** for new work.

**Gateway API** is a family of resources (`GatewayClass`, `Gateway`, `HTTPRoute`, `GRPCRoute`, and others) that separate infrastructure and application routing more clearly, and cover cases that Ingress handled only with annotations. The core kinds are stable. Gateway API is installed as custom resources and still needs a controller. Moving existing Ingress objects is a conversion, not an automatic rename.

## ConfigMaps and Secrets

A **ConfigMap** holds non-confidential configuration as keys and values. You can mount it as files or expose it as environment variables.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: shop-api-config
data:
  APPLICATION_ENV: production
  logging.level.root: INFO
```

A **Secret** is the object for credentials, tokens, and similar data. In manifests the values are typically **base64-encoded**, which is encoding, not encryption. Secret data is stored in etcd. Encryption at rest is something you configure on the API server; it is not automatic just because the object kind is `Secret`. Treat RBAC, etcd access, and encryption configuration as part of Secret hygiene. Do not check production Secrets into a public repository.

Pods reference ConfigMaps and Secrets by name. Changing a ConfigMap used as an environment variable does not always restart the process. When the app will not reread config on its own, a rolling restart of the Deployment is the straightforward approach.

## Namespaces

A **Namespace** is a scope for names and for many authorization and resource policies. Built-in namespaces include `default`, `kube-system`, and `kube-public`. Teams often use one namespace per application or environment (`shop-prod`, `shop-dev`).

Most names only have to be unique inside a namespace. Nodes, PersistentVolumes, and some other objects are cluster-scoped. Namespaces are not a full security wall on their own, but they are the usual unit for access control and quotas.

```bash
kubectl create namespace shop-prod
kubectl apply -f shop-api.yaml -n shop-prod
kubectl -n shop-prod get pods
```

## Volumes, PersistentVolumes, and StorageClasses

A container's writable layer is removed when the container is removed. **Volumes** let a Pod mount storage that outlives a single container restart.

- A **volume** in a Pod spec can be empty directory space, a ConfigMap, a Secret, or a claim on durable storage.
- A **PersistentVolume (PV)** is a piece of storage in the cluster, provisioned statically or dynamically.
- A **PersistentVolumeClaim (PVC)** is a request for storage (size, access mode) that a Pod mounts. The claim binds to a PV.
- A **StorageClass** names a provisioner and parameters (disk type, reclaim policy). A PVC can request a class, and the cluster creates a matching PV.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shop-data
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: standard
```

Access modes matter. `ReadWriteOnce` is typically one node at a time. A Deployment with several replicas cannot all mount the same `ReadWriteOnce` volume the way a single StatefulSet replica can. For shared filesystems you need a class and access mode that support that, or a different data architecture (object storage, a database).

## StatefulSets

A **StatefulSet** is for workloads that need stable network identity and stable storage: databases, queues, and other systems where each instance is not interchangeable.

Each Pod gets a stable name (`shop-db-0`, `shop-db-1`), a per-Pod PVC from a volume claim template, and, usually, a **headless Service** so DNS can resolve those names. Startup, scale-up, and scale-down are ordered. Updating a StatefulSet is more cautious than a Deployment's rolling update; you choose a strategy and pay attention to the order.

If your process is stateless, a Deployment is the simpler tool. A StatefulSet does not by itself make a database highly available. It gives you predictable names and disks; clustering and failover remain the application's job.

## DaemonSets

A **DaemonSet** ensures that a Pod runs on all nodes (or on the nodes you select). It is the usual pattern for node-level agents: log collectors, monitoring exporters, and some CNI or storage helpers. When a node joins, a Pod is scheduled there. When a node leaves, that Pod is gone with it. You do not pick a replica count the way you do with a Deployment.

## Jobs and CronJobs

A **Job** runs one or more Pods until a specified number of them complete successfully. It is for batch work: a report, a database migration, a one-off import. Failed Pods can be retried according to the Job spec.

A **CronJob** creates Jobs on a schedule, using a cron expression. Time zones and concurrency policy (forbid, allow, or replace overlapping runs) are part of the spec. Do not assume a missed run will always be replayed if the cluster was down at the scheduled time.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: shop-nightly-report
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: report
              image: ghcr.io/example/shop-report:1.0
              args: ["--report=nightly"]
```

## Resource Requests, Limits, and QoS

Each container can declare **requests** (what the scheduler reserves) and **limits** (the cap the runtime enforces). CPU is measured in cores or millicores (`100m` is one-tenth of a core). Memory is usually given in `Mi` or `Gi`.

The scheduler uses requests to decide whether a node has room. If you omit requests, a node can be overcommitted without Kubernetes knowing. Limits cap usage: CPU is throttled, and a memory limit can get the container killed (OOM).

Kubernetes assigns a **Quality of Service (QoS)** class from those numbers:

- **Guaranteed**: every container has a request and a limit, and they are equal for CPU and for memory.
- **Burstable**: at least one container has a request or limit, but the Pod is not Guaranteed.
- **BestEffort**: no requests or limits.

When a node runs out of memory, BestEffort Pods are evicted first, then Burstable, then Guaranteed. Requests and limits are how the cluster shares a node, not a billing feature.

## Probes

The kubelet can probe containers in three ways:

- A **liveness** probe asks whether the process should be restarted. A failing liveness probe leads to a restart, which can turn a temporary stall into a restart loop if the probe is too aggressive.
- A **readiness** probe asks whether the Pod should receive Service traffic. A failing readiness probe removes the Pod from Service endpoints without necessarily restarting it. Use this for startup warmup, dependency checks, or overload.
- A **startup** probe delays liveness and readiness until the application has started. It is the right tool for a slow JVM boot, so liveness does not kill the process before it is ready.

Probes can be HTTP, TCP, or a command. For a Spring Boot app, an HTTP check against an actuator health path is a common pattern, as long as that path is a cheap, honest signal.

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  failureThreshold: 30
  periodSeconds: 5
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 5
```

## Autoscaling

**Horizontal Pod Autoscaler (HPA)** adjusts the replica count of a Deployment (or similar) based on metrics, typically CPU or memory utilization, or custom metrics. It needs resource requests so utilization has a denominator, and a metrics source such as Metrics Server.

**Vertical Pod Autoscaler (VPA)** recommends or applies changes to a Pod's requests and limits. It is a widely used add-on in the Kubernetes autoscaler project, not something every cluster ships by default. Combining HPA and VPA on the same resource needs care, because they can fight over the same knobs.

The **Cluster Autoscaler** (also commonly an add-on, and cloud-specific in practice) adds or removes nodes when Pods cannot be scheduled for lack of room, or when nodes are underused. HPA changes the number of Pods; the cluster autoscaler changes the number of machines those Pods can land on.

None of these will help if the application cannot run as more than one replica, or if a single Pod is too large to fit on any node.

## RBAC and ServiceAccounts

Human users and controllers authenticate to the API server. In-cluster processes usually use a **ServiceAccount**. A Pod can mount a token for its ServiceAccount and call the API with that identity.

**Role-based access control (RBAC)** binds identities to permissions:

- A **Role** lists allowed verbs on resources in a namespace (`get`, `list`, `watch`, `create`, and so on).
- A **ClusterRole** is the cluster-scoped equivalent, and can also grant access to cluster-scoped resources such as nodes.
- A **RoleBinding** or **ClusterRoleBinding** attaches a Role or ClusterRole to users, groups, or ServiceAccounts.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: shop-config-reader
  namespace: shop-prod
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: shop-api-reads-config
  namespace: shop-prod
subjects:
  - kind: ServiceAccount
    name: shop-api
    namespace: shop-prod
roleRef:
  kind: Role
  name: shop-config-reader
  apiGroup: rbac.authorization.k8s.io
```

The default ServiceAccount in a namespace should not be treated as a powerful admin identity. Give workloads the narrowest Role they need.

## The Networking Model

Kubernetes has a simple network model, implemented by a **CNI** (Container Network Interface) plugin such as Calico, Cilium, Flannel, or a cloud provider's plugin:

- Every Pod gets its own IP address, reachable from other Pods in the cluster without network address translation between Pods (in the standard model).
- Containers in a Pod share that IP and can use `localhost`.
- Nodes and the CNI plugin make Pod-to-Pod routing work across the cluster.
- Services add stable virtual IPs and DNS on top of those Pod IPs. kube-proxy (or an equivalent data path some CNI plugins provide) implements the Service steering.

You do not assign Pod IPs by hand, and a Pod IP is not stable across restarts; that is what Services and StatefulSet DNS are for. NetworkPolicies can restrict who may connect to whom, if the CNI plugin enforces them. DNS inside the cluster is usually CoreDNS, which is how `shop-api.shop-prod.svc.cluster.local` resolves.

## What Happens on `kubectl apply` of a Deployment

Suppose you run `kubectl apply -f shop-api.yaml` with a Deployment and a Service. A simplified sequence looks like this:

1. `kubectl` reads your kubeconfig, contacts the API server, and sends the objects. The API server authenticates you, authorizes the request with RBAC, validates the YAML against the API schema, and writes the objects to etcd.
2. The **Deployment controller** sees a Deployment with no matching ReplicaSet (or with a template change). It creates or updates a ReplicaSet with the desired replica count and Pod template.
3. The **ReplicaSet controller** sees that it has fewer Pods than desired. It creates Pod objects. Those Pods are at first unschedulable in the sense that they have no `nodeName`.
4. The **scheduler** binds each Pod to a node that has enough remaining requests, matches any selectors or tolerations, and is otherwise eligible.
5. The **kubelet** on that node sees the bound Pod. It pulls the image if needed, creates a Pod sandbox (network namespace and IP, via the runtime and CNI), starts the containers, mounts volumes, and begins probes.
6. When a container becomes **ready**, the EndpointSlice controller (or equivalent) adds the Pod IP to the Service's backends. kube-proxy updates the node so traffic to the Service can reach it.
7. If you later change the image and apply again, the Deployment controller starts a new ReplicaSet and rolls from the old one to the new one. `kubectl rollout status` watches that progress.

If a step fails, the object usually still exists, with a status you can inspect: `Pending` (often scheduling or image pull), `CrashLoopBackOff` (the process keeps exiting), or a rollout stuck because new Pods never become ready. The fix is in events, logs, and `kubectl describe`, not in applying the same file harder.

## kubectl Essentials

`kubectl` is the standard API client. A few commands cover most daily work:

```bash
kubectl get nodes
kubectl get pods -A
kubectl get deploy,rs,svc,ing -n shop-prod
kubectl describe pod shop-api-7d9c4f8b6-abcde
kubectl logs deploy/shop-api -n shop-prod --tail=100
kubectl logs deploy/shop-api -n shop-prod -c shop-api -f
kubectl exec -it deploy/shop-api -n shop-prod -- /bin/sh
kubectl apply -f shop-api.yaml
kubectl diff -f shop-api.yaml
kubectl delete -f shop-api.yaml
kubectl port-forward svc/shop-api 8080:80 -n shop-prod
kubectl config get-contexts
kubectl config use-context kind-kind
```

`kubectl apply` is the usual way to keep objects in sync with files (client-side last-applied annotations or server-side apply). `kubectl create` is imperative and less convenient for later changes. `kubectl delete` removes the objects, and a Deployment's Pods go with it. Prefer `kubectl logs deploy/name` over chasing a Pod name that will change on the next rollout.

## Local and Managed Clusters

For learning and inner-loop work, you can run a cluster on your machine:

- **kind** (Kubernetes in Docker) creates cluster nodes as containers. It is a common choice for local testing and CI.
- **minikube** runs a local cluster with various drivers and add-ons (an Ingress controller, a dashboard, and so on).
- **k3d** wraps k3s, a lightweight distribution, in Docker, and is also used for fast local clusters.

These expose a real Kubernetes API, but they are not a copy of your production network, storage, or load balancers. Treat them as a place to apply manifests and learn the control loop.

Managed services run the control plane for you and provide node pools, integrations, and often a default CNI and StorageClass:

- **Amazon EKS**
- **Google GKE**
- **Microsoft AKS**

The objects in this article are the same across these environments. What changes is how you authenticate, how `LoadBalancer` Services are fulfilled, which StorageClasses exist, and how upgrades are performed.

## Step by Step: Deploying a Spring Boot App

The application can be a small Spring Boot service that listens on 8080 and exposes a health endpoint. Build a container image and push it to a registry the cluster can pull from. Kubernetes only sees the image, not your build tool.

A minimal Dockerfile shape looks like this (your build tool may produce a layer-efficient image instead):

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY build/libs/shop-api.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Then, in a local cluster:

```bash
kind create cluster
# or: minikube start
# load or push the image so the cluster can pull it
kubectl create namespace shop-dev
```

Apply a Deployment, a Service, and a ConfigMap. The Deployment example earlier in this article is enough for a first run; add probes and the ConfigMap when the app is healthy:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: shop-api
  namespace: shop-dev
spec:
  selector:
    app: shop-api
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
  namespace: shop-dev
spec:
  replicas: 2
  selector:
    matchLabels:
      app: shop-api
  template:
    metadata:
      labels:
        app: shop-api
    spec:
      containers:
        - name: shop-api
          image: ghcr.io/example/shop-api:1.0
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: shop-api-config
          resources:
            requests:
              cpu: "200m"
              memory: "512Mi"
            limits:
              cpu: "1"
              memory: "1Gi"
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
```

```bash
kubectl apply -f shop-api.yaml
kubectl -n shop-dev rollout status deployment/shop-api
kubectl -n shop-dev get pods,svc
kubectl -n shop-dev port-forward svc/shop-api 8080:80
```

From there you can add an Ingress or a Gateway, an HPA once Metrics Server is present, and a Secret if the app needs a database password. Change the manifest, apply it, and watch the rollout, rather than patching live Pods. If Pods stay `Pending`, describe them for image-pull or scheduling events. If they restart, read the logs. If they run but the Service has no endpoints, check the readiness probe and the selector.

## Common Mistakes

- **Running a bare Pod in production** and expecting it to return after a node failure. Use a Deployment, StatefulSet, DaemonSet, or Job.
- **Forgetting a Service selector**, or using labels that do not match the Pod template, so the Service has no endpoints.
- **Putting a load balancer in front of nothing ready.** Without a readiness probe, Kubernetes may send traffic to a JVM that is still starting.
- **Using a liveness probe as a readiness probe**, or setting a tight liveness check on a slow-starting Spring Boot app, which produces `CrashLoopBackOff`.
- **Skipping resource requests.** The scheduler then cannot pack the node honestly, and HPA utilization is poorly defined.
- **Mounting a `ReadWriteOnce` volume on a Deployment with several replicas** and wondering why some Pods will not schedule.
- **Storing real secrets in a ConfigMap**, or committing Secret YAML to a public repo, or assuming base64 is encryption.
- **Editing a live Pod** that a Deployment owns. The controller will reconcile it away.
- **Expecting Ingress or Gateway objects to work without a controller** installed in the cluster.
- **Using `latest` as an image tag** and not knowing which build is actually running. Pin a version and change it in the manifest to roll out.
- **Giving every Pod the default ServiceAccount with broad cluster rights.**
- **Treating `kubectl apply` as a deploy button and ignoring `rollout status`, events, and logs** when the new revision is not becoming ready.

## Quick Reference

| Goal | Starting point |
| --- | --- |
| Long-running stateless app | Deployment + Service |
| Rolling update / undo | `kubectl rollout status` / `undo` |
| HTTP entry from outside | Ingress (frozen API) or Gateway API, plus a controller |
| Config and credentials | ConfigMap and Secret |
| Durable disks | PVC + StorageClass; StatefulSet if identity matters |
| One agent per node | DaemonSet |
| Batch or schedule | Job / CronJob |
| Scale Pods with load | HPA (needs requests and metrics) |
| Scale nodes | Cluster autoscaler |
| Permissions for a Pod | ServiceAccount + Role + RoleBinding |

```bash
kubectl apply -f manifest.yaml
kubectl get pods,svc,deploy -n <ns>
kubectl describe pod <name> -n <ns>
kubectl logs deploy/<name> -n <ns>
kubectl rollout status deployment/<name> -n <ns>
kubectl rollout undo deployment/<name> -n <ns>
kubectl exec -it deploy/<name> -n <ns> -- /bin/sh
kubectl port-forward svc/<name> 8080:80 -n <ns>
kubectl diff -f manifest.yaml
```

Current project practice as of November 2026 is to run a supported minor (the 1.37, 1.36, or 1.35 lines), a CRI runtime such as containerd, and pinned image tags. Dockershim is long gone; it was removed in 1.24.

## Conclusion

Kubernetes is a declarative control system for containers. You store desired state in the API, and controllers, the scheduler, and the kubelet work to make the cluster look like that state. The control plane (API server, etcd, scheduler, controller managers) is the brain. Nodes run kubelet, a CRI runtime, and kube-proxy. The objects you write most often are Pods, Deployments, Services, and the configuration and storage that those Pods mount.

The rest of the API fills in specific jobs: Ingress or Gateway API for HTTP entry, StatefulSets for stable identity, DaemonSets for per-node agents, Jobs for work that should finish, HPA for replica counts, and RBAC for who may change any of it. `kubectl apply` is just the request that starts a reconciliation loop you can watch.

Start with a small Deployment and a Service in a local cluster, add probes and requests before you add autoscaling, and treat the official API docs as the source for version-specific details. The model stays the same from kind on a laptop to a managed cluster: describe what you want, then let the control loop keep it true.
