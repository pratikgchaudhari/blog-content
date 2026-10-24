---
title: Top 50 Kubernetes Interview Questions and Answers
date: 2026-10-20
summary: Concise, interview-ready answers to the most frequently asked Kubernetes questions covering architecture, workloads, networking, storage, security, and scaling.
tag: Kubernetes
draft: false
---

## 1. What is Kubernetes?
Kubernetes (K8s) is an open-source container orchestration platform that automates deployment, scaling, and management of containerized applications across a cluster of machines.

## 2. What is a Pod?
A Pod is the smallest deployable unit in Kubernetes. It wraps one or more containers that share the same network namespace (IP and ports) and storage volumes.

## 3. What is a Deployment?
A Deployment is a controller that manages a set of identical Pods via ReplicaSets. It enables declarative updates, rolling updates, and easy rollbacks.

## 4. What is a ReplicaSet?
A ReplicaSet ensures that a specified number of Pod replicas are running at any time. It is usually managed by a Deployment rather than used directly.

## 5. What is a Service?
A Service provides a stable virtual IP and DNS name to access a dynamic set of Pods selected by labels, abstracting away Pod IP changes.

## 6. What are the common Service types?
- **ClusterIP**: Internal-only access (default)
- **NodePort**: Exposes the Service on a static port on each node
- **LoadBalancer**: Provisions an external load balancer (cloud environments)
- **ExternalName**: Maps the Service to an external DNS name

## 7. What is a Namespace?
A Namespace is a virtual cluster that provides logical isolation of resources (Pods, Services, etc.) within a physical cluster. Useful for multi-tenancy or environment separation.

## 8. What is a ConfigMap?
A ConfigMap stores non-sensitive configuration data as key-value pairs that can be injected into Pods as environment variables or mounted as files.

## 9. What is a Secret?
A Secret stores sensitive data (passwords, tokens, keys) in base64-encoded form. It is similar to a ConfigMap but intended for confidential information.

## 10. What is Ingress?
Ingress is an API object that manages external HTTP/HTTPS access to Services. It provides routing rules, TLS termination, and load balancing via an Ingress controller.

## 11. What is a PersistentVolume (PV)?
A PV is a piece of storage in the cluster that has been provisioned by an administrator or dynamically by a StorageClass. It is independent of any Pod.

## 12. What is a PersistentVolumeClaim (PVC)?
A PVC is a request for storage by a user. It specifies size, access mode, and optionally a StorageClass. Kubernetes binds it to a matching PV.

## 13. What is a StorageClass?
A StorageClass defines the "class" of storage (e.g., SSD, HDD) and the provisioner used for dynamic volume creation, along with parameters.

## 14. What are the main control plane components?
- **kube-apiserver**: Front-end of the control plane; all requests go through it
- **etcd**: Distributed key-value store for cluster state
- **kube-scheduler**: Assigns Pods to nodes
- **kube-controller-manager**: Runs controller processes (e.g., Deployment, ReplicaSet)
- **cloud-controller-manager**: Integrates with cloud provider APIs

## 15. What is etcd?
etcd is a consistent, highly available key-value store that holds all cluster data and configuration. It is the source of truth for the cluster state.

## 16. What does the kube-scheduler do?
The scheduler watches for newly created Pods with no node assigned and selects the best node for them based on resource requirements, affinity rules, taints, and other constraints.

## 17. What is the kubelet?
The kubelet is the primary agent that runs on each node. It ensures containers described in PodSpecs are running and healthy, and reports node and Pod status to the control plane.

## 18. What is kube-proxy?
kube-proxy runs on each node and maintains network rules (iptables, IPVS, or nftables) so that Service IPs and ports correctly route to the backend Pods.

## 19. What is a Node?
A Node is a worker machine (physical or virtual) in the cluster that runs Pods. It is managed by the control plane and has the kubelet, kube-proxy, and a container runtime.

## 20. What is a StatefulSet?
A StatefulSet manages stateful applications. It provides stable network identities (predictable pod names and DNS), ordered deployment/scaling, and stable persistent storage for each replica.

## 21. What is a DaemonSet?
A DaemonSet ensures that a copy of a Pod runs on all (or a subset of) nodes in the cluster. Commonly used for logging agents, monitoring agents, or CNI plugins.

## 22. What is a Job?
A Job creates one or more Pods and ensures that a specified number of them successfully complete. Once the desired number of completions is reached, the Job is considered complete.

## 23. What is a CronJob?
A CronJob creates Jobs on a repeating schedule (using cron syntax). It is useful for periodic tasks such as backups or report generation.

## 24. What are Liveness, Readiness, and Startup Probes?
- **Liveness**: Checks if the container is alive; restarts it if it fails
- **Readiness**: Checks if the container is ready to serve traffic; removes it from Service endpoints if it fails
- **Startup**: Delays liveness/readiness checks until the application has started (useful for slow-starting apps)

## 25. What is Horizontal Pod Autoscaler (HPA)?
HPA automatically scales the number of Pod replicas in a Deployment, ReplicaSet, or StatefulSet based on observed metrics such as CPU utilization, memory, or custom metrics.

## 26. What is RBAC?
Role-Based Access Control (RBAC) regulates access to Kubernetes resources. It uses Roles/ClusterRoles (permissions) and RoleBindings/ClusterRoleBindings (who gets those permissions).

## 27. What is a ServiceAccount?
A ServiceAccount provides an identity for processes running in Pods. It is used to authenticate with the Kubernetes API server and is associated with tokens and RBAC permissions.

## 28. What are Labels and Selectors?
Labels are key-value pairs attached to objects for identification and organization. Selectors are used by controllers and Services to select a subset of objects based on their labels.

## 29. What are Taints and Tolerations?
Taints are applied to nodes to repel Pods. Tolerations are applied to Pods to allow them to be scheduled on nodes with matching taints. Together they control node placement.

## 30. What is Pod Affinity and Anti-Affinity?
Affinity rules attract Pods to certain nodes or co-locate them with other Pods. Anti-affinity rules repel Pods from certain nodes or other Pods. They are based on labels.

## 31. What is a NetworkPolicy?
A NetworkPolicy is a specification of how groups of Pods are allowed to communicate with each other and other network endpoints. It is implemented by CNI plugins that support it.

## 32. What is CNI?
Container Network Interface (CNI) is a standard specification and set of libraries for configuring network interfaces in Linux containers. Popular plugins include Calico, Cilium, and Flannel.

## 33. What is Helm?
Helm is a package manager for Kubernetes. It uses charts (packages of pre-configured Kubernetes resources) to define, install, and upgrade even the most complex applications.

## 34. What is a Custom Resource Definition (CRD)?
A CRD allows you to define your own resource types, extending the Kubernetes API. Once defined, you can create and manage custom resources just like built-in ones.

## 35. What is an Operator?
An Operator is a method of packaging, deploying, and managing a Kubernetes application using custom resources and controllers. It encodes operational knowledge as software.

## 36. What is the difference between `kubectl create` and `kubectl apply`?
`create` is imperative and fails if the resource already exists. `apply` is declarative — it creates the resource if it doesn't exist or updates it to match the desired state if it does.

## 37. What is a rolling update?
A rolling update gradually replaces old Pods with new ones (by creating new ReplicaSets) so that the application remains available during the update. Controlled by `maxUnavailable` and `maxSurge`.

## 38. What are Resource Requests and Limits?
- **Request**: The minimum amount of CPU/memory guaranteed to the container (used for scheduling)
- **Limit**: The maximum amount of CPU/memory the container is allowed to use

## 39. What are the QoS classes in Kubernetes?
- **Guaranteed**: Request equals Limit for all containers
- **Burstable**: Request is set but lower than Limit
- **BestEffort**: No Request or Limit set

## 40. What is an Init Container?
Init Containers run before the main application containers start. They must complete successfully. They are used for setup tasks such as waiting for dependencies or initializing data.

## 41. What is a Sidecar Container?
A Sidecar is a container that runs alongside the main application container in the same Pod. It provides supporting functionality such as logging, proxying, or monitoring.

## 42. What is a kubeconfig file?
A kubeconfig file configures access to clusters. It contains information about clusters, users (credentials), and contexts (which cluster + user combination to use).

## 43. What is the Kubernetes API?
The Kubernetes API is a REST API that serves as the frontend for the control plane. All operations (create, read, update, delete) on cluster resources go through the API server.

## 44. What is a Volume in Kubernetes?
A Volume is a directory, possibly with data, that is accessible to the containers in a Pod. Volumes outlive individual containers and support many types (emptyDir, hostPath, persistent, configMap, etc.).

## 45. What is the Cluster Autoscaler?
The Cluster Autoscaler automatically adjusts the number of nodes in a cluster by adding nodes when Pods fail to schedule due to insufficient resources, and removing underutilized nodes.

## 46. What is the Vertical Pod Autoscaler (VPA)?
VPA automatically adjusts the CPU and memory requests and limits of containers based on historical usage, helping right-size Pods without changing the replica count.

## 47. What is the difference between a Deployment and a StatefulSet?
Deployments are for stateless applications where Pods are interchangeable. StatefulSets provide stable network identities, ordered deployment, and persistent storage for stateful applications.

## 48. What happens when you delete a Pod?
The Pod enters Terminating state, containers receive SIGTERM (then SIGKILL after the grace period), associated volumes are unmounted, and the Pod object is removed. Controllers may recreate it if the desired state requires it.

## 49. How do you troubleshoot a Pod stuck in CrashLoopBackOff?
1. `kubectl describe pod <name>` — check Events
2. `kubectl logs <pod>` and `kubectl logs <pod> --previous` — check application logs
3. Verify image, command, probes, resource limits, and ConfigMaps/Secrets

## 50. What is the Container Runtime Interface (CRI)?
CRI is the plugin interface that allows kubelet to use different container runtimes (such as containerd or CRI-O) without hard-coding support for any specific runtime.
