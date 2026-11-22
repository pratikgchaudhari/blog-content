---
title: How Docker Works Internally - Namespaces, Cgroups, OverlayFS, containerd and runc Explained
date: 2026-11-21
summary: A detailed look under the hood of Docker covering its architecture, Linux namespaces and cgroups, overlay2 image layers, registries, networking, volumes, security, Docker Desktop, a hand-built container and running Java in containers.
tag: docker, containers, linux, devops, backend
draft: false
related: kubernetes-basics,kubernetes-interview-questions,linux-file-systems,linux-file-system-structure,virtual-memory-explained
---

Docker is a platform for building, shipping, and running applications in containers. A container packages an application together with everything it needs (libraries, runtime, configuration) and runs it as an isolated process on a shared Linux kernel. The same image runs the same way on a laptop, a CI server, and a production cluster.

Docker was released by dotCloud in 2013. Containers weren't new (Linux already had namespaces, cgroups and LXC), but Docker added a simple experience on top: a `Dockerfile`, layered images, a public registry and one `docker run` command. The pieces underneath have since been standardised by the Open Container Initiative (OCI) and split into projects like containerd and runc, which also power Kubernetes.

This article looks under the hood: the processes involved, the kernel features behind the isolation, how images, networking and storage work, and what it means for Java applications.

## Containers vs Virtual Machines

The key thing to understand is that **a container is just a process**.

A **virtual machine** emulates hardware. A hypervisor runs one or more guest operating systems, each with its own kernel, its own memory management, and its own boot process.

A **container** runs directly on the host's kernel. The kernel gives the process a restricted view of the system (its own process list, its own network interfaces, its own filesystem root) and limits the resources it can use.

```
        Virtual machines                         Containers

+---------+---------+---------+       +---------+---------+---------+
|  App A  |  App B  |  App C  |       |  App A  |  App B  |  App C  |
|  Libs   |  Libs   |  Libs   |       |  Libs   |  Libs   |  Libs   |
| Guest OS| Guest OS| Guest OS|       +---------+---------+---------+
| (kernel)| (kernel)| (kernel)|       |     Container runtime       |
+---------+---------+---------+       +-----------------------------+
|         Hypervisor          |       |   Host OS (one shared kernel)|
+-----------------------------+       +-----------------------------+
|          Hardware           |       |          Hardware           |
+-----------------------------+       +-----------------------------+
```

This difference has practical consequences:

- **Startup and overhead**: a container starts as fast as its process and needs no duplicate OS in memory. A VM boots a whole kernel.
- **Isolation**: a hypervisor is a much smaller attack surface than the kernel API containers share, so a kernel bug can affect every container on a host.
- **Compatibility**: a Linux container needs a Linux kernel. You cannot run a Linux container natively on macOS or Windows (more on that later).

Start `docker run -d --name web nginx` and run `ps -ef | grep "nginx: master"` on the host: the nginx master shows up with a normal host PID, while inside the container it believes it is PID 1.

## Docker Architecture

When you type `docker run`, several programs cooperate. Each has a narrow job.

```
docker CLI
    |   REST API over /var/run/docker.sock
    v
dockerd  (Docker Engine: images, builds, networks, volumes, API)
    |   gRPC
    v
containerd  (container lifecycle, image content, snapshots)
    |
    v
containerd-shim-runc-v2  (one per container, stays running)
    |
    v
runc  (creates the container, then exits)
    |
    v
your process (PID 1 inside the container)
```

### The Docker CLI

The **`docker` command** is only a client. It turns your commands into HTTP requests to the Docker Engine API. By default it talks over a Unix socket at `/var/run/docker.sock`, but it can also talk to a remote daemon. You can call it directly with `curl --unix-socket /var/run/docker.sock http://localhost/containers/json`.

### dockerd

**`dockerd`** is the Docker daemon. It handles the high-level features users interact with: building images, managing networks and volumes, pulling and pushing images, logging, and the API itself. It does not create containers by itself. It delegates that to containerd.

### containerd

**containerd** is a container runtime that manages the full lifecycle of containers on a host: pulling and storing image content, preparing filesystem snapshots, and starting and stopping containers. Docker donated it to the Cloud Native Computing Foundation (CNCF) in 2017. Kubernetes can use containerd directly through the Container Runtime Interface (CRI), without Docker at all. That is why Kubernetes removing its Docker integration (dockershim, in version 1.24) did not break images built with Docker: they are standard OCI images, and containerd runs them fine.

### containerd-shim

For every running container there is a small **shim** process (`containerd-shim-runc-v2`). It becomes the parent of the container's process, keeps its standard input and output open, and reports its exit status. Because the shim sits in between, containerd and dockerd can be restarted or upgraded without killing running containers.

### runc

**runc** is the low-level runtime that actually talks to the kernel. It reads a configuration file, creates the namespaces, sets up cgroups, mounts the root filesystem, applies security settings, and finally executes your program. Once the container process is running, runc exits. It's a reference implementation of the OCI runtime specification, and alternatives exist, such as crun (written in C) and gVisor's runsc (which adds a user-space kernel for stronger isolation).

### The OCI Specifications

The **Open Container Initiative**, formed in 2015, defines three specifications that keep this ecosystem interoperable:

- The **runtime specification** describes a "bundle": a root filesystem directory plus a `config.json` that lists the process to run, environment variables, mounts, namespaces, cgroup limits, and capabilities.
- The **image specification** describes how images are packaged: manifests, configuration, and layers.
- The **distribution specification** describes the HTTP API registries use to push and pull images.

So an image built by Docker runs on Podman, containerd or CRI-O.

## Namespaces: Isolation

**Namespaces** are a Linux kernel feature that gives a process its own view of a particular global resource. Each type of namespace isolates one thing:

| Namespace | Isolates | Effect inside the container |
|---|---|---|
| `pid` | Process IDs | Sees only its own processes; the main one is PID 1 |
| `net` | Network stack | Own interfaces, IP addresses, routes, ports, firewall rules |
| `mnt` | Mount points | Own filesystem tree, own root |
| `uts` | Hostname and domain name | Own hostname (the container ID by default) |
| `ipc` | System V IPC and POSIX message queues | Cannot share memory segments with host processes |
| `user` | User and group IDs | Root inside can map to an unprivileged user outside |
| `cgroup` | View of the cgroup hierarchy | Sees its own cgroup as the root |

Linux also has a `time` namespace, but Docker does not use it by default.

Every process's namespaces are visible under `/proc`:

```bash
PID=$(docker inspect -f '{{.State.Pid}}' web)
sudo ls -l /proc/$PID/ns
```

Each entry is a link like `net:[4026532453]`. Two processes are in the same namespace if these numbers match. You can also enter a container's namespaces from the host with `nsenter`, which is roughly what `docker exec` does:

```bash
sudo nsenter --target $PID --net ip addr
```

This runs the host's `ip` binary but inside the container's network namespace, so you see the container's interfaces.

Namespaces can also be shared on purpose (`--network container:web`, `--pid host`). Kubernetes pods share a network namespace, which is why their containers talk over `localhost`.

## Cgroups: Resource Limits

Namespaces control what a process can **see**. **Control groups (cgroups)** control what it can **use**: CPU, memory, I/O, and the number of processes.

### Cgroups v1 and v2

There are two versions:

- **cgroups v1** had a separate hierarchy per controller (`/sys/fs/cgroup/memory/`, `/sys/fs/cgroup/cpu/`, and so on).
- **cgroups v2** uses one unified hierarchy under `/sys/fs/cgroup` with better memory accounting. It's the default on modern distributions.

You can check which version a host uses:

```bash
stat -fc %T /sys/fs/cgroup
```

`cgroup2fs` means v2. `tmpfs` means v1.

### Setting Limits

Docker flags translate directly into cgroup files:

```bash
docker run -d --name api --memory 512m --cpus 1.5 --pids-limit 200 nginx
```

On a cgroups v2 host using the systemd driver, you can read the values back:

```bash
ID=$(docker inspect -f '{{.Id}}' api)
cat /sys/fs/cgroup/system.slice/docker-$ID.scope/memory.max
cat /sys/fs/cgroup/system.slice/docker-$ID.scope/cpu.max
cat /sys/fs/cgroup/system.slice/docker-$ID.scope/pids.max
```

```
536870912
150000 100000
200
```

`memory.max` is 512 MiB in bytes. `cpu.max` means "150,000 microseconds of CPU time per 100,000 microsecond period", which is 1.5 CPUs. `pids.max` caps the number of processes and threads, which protects the host from a fork bomb.

The two most important behaviours to know:

- **Memory** is a hard limit. If the container's processes use more than `memory.max` and the kernel cannot reclaim enough, the OOM killer kills a process inside the cgroup. The container exits with code 137 (128 + SIGKILL), and `docker inspect` shows `OOMKilled: true`.
- **CPU** is a quota, not a reservation. A container that uses up its quota within a period is throttled until the next period starts. It is not killed, but its latency can suffer. `docker run --cpus` sets this quota, while `--cpu-shares` only sets a relative weight that matters under contention.

`docker stats` shows live usage.

## Images and Layers

A Docker **image** is a read-only template for a container's filesystem, plus metadata such as the default command, environment variables, exposed ports, and working directory.

### Layers

Images are built from **layers**. Each instruction in a Dockerfile that changes the filesystem creates a new layer containing only the changes from the previous one:

```dockerfile
FROM eclipse-temurin:21-jre        # base layers (OS + JRE)
WORKDIR /app
COPY target/app.jar app.jar        # one layer with the jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

```
+-----------------------------------+
|  app.jar                          |   layer 3 (COPY)
+-----------------------------------+
|  /app directory                   |   layer 2 (WORKDIR)
+-----------------------------------+
|  JRE files                        |   base image layers
|  Ubuntu userland                  |
+-----------------------------------+
```

Layers are shared: images with the same base store and download it once, and changing only your jar changes only the top layer. That's why Dockerfile order matters: put rarely changing things (dependencies) before often changing ones (code) to keep the build cache valid.

### overlay2: Stacking Layers into One Filesystem

When a container starts, its layers need to look like a single normal filesystem. Docker's default storage driver on Linux, **overlay2**, uses the kernel's **OverlayFS** to do this. OverlayFS combines several directories into one view:

- **lowerdir**: one or more read-only layers (the image).
- **upperdir**: a writable layer, created fresh for each container.
- **workdir**: a scratch directory OverlayFS needs internally.
- **merged**: the combined view, which becomes the container's root filesystem.

```
merged (what the container sees):   /bin  /etc  /app/app.jar  /tmp/new.log
                                       ^      ^       ^             ^
upperdir (container, read-write):      |      |       |        /tmp/new.log
lowerdir (image layers, read-only):  /bin   /etc  /app/app.jar
```

You can see these paths for a running container:

```bash
docker inspect -f '{{json .GraphDriver.Data}}' web | python3 -m json.tool
```

The rules are simple:

- **Reading** a file returns the topmost version found.
- **Writing** to a file that exists only in a lower layer triggers **copy-up**: the whole file is copied into the upper layer first, then modified. Copy-up works on whole files, so modifying a small part of a large file in the image is expensive the first time.
- **Deleting** a file from a lower layer creates a **whiteout** in the upper layer, a special marker that hides the file. The original still exists in the image layer, which is why deleting files in a later Dockerfile step does not make an image smaller.
- **Removing the container** deletes its upper layer. Anything written there is gone. Data that must survive needs a volume.

On disk, layers live under `/var/lib/docker/overlay2/`. Recent Docker versions can also use containerd's image store, where containerd "snapshotters" manage the layers instead, but the OverlayFS idea is the same.

### Manifests, Digests, and Registries

Images are stored and transferred using **content addressing**. Every piece of an image is identified by the SHA-256 hash of its contents, called a **digest**.

An image consists of:

- **Layer blobs**: compressed tar archives of filesystem changes.
- A **config blob**: JSON describing the default command, environment, architecture, and the list of layer diff IDs. The image ID you see locally is derived from this config.
- A **manifest**: JSON that lists the config and the layers by digest.

```json
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.oci.image.manifest.v1+json",
  "config": {
    "mediaType": "application/vnd.oci.image.config.v1+json",
    "digest": "sha256:3f1a...",
    "size": 7023
  },
  "layers": [
    { "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
      "digest": "sha256:9b2c...", "size": 29534055 }
  ]
}
```

For multi-architecture images, an **image index** (or manifest list) sits on top and points to one manifest per platform, such as `linux/amd64` and `linux/arm64`. When you pull, Docker picks the manifest matching your machine.

A **registry** (Docker Hub, GitHub Container Registry, Amazon ECR, a self-hosted registry) stores these blobs and manifests and serves them over the OCI distribution API. A pull looks roughly like this:

1. Resolve the tag: `GET /v2/library/nginx/manifests/latest` returns the index or manifest.
2. Select the platform's manifest.
3. Download the config blob and every layer blob not already present locally: `GET /v2/library/nginx/blobs/sha256:...`.
4. Verify each blob against its digest and unpack the layers.

A **tag** like `nginx:1.27` is a mutable pointer and can be moved to a different image at any time. A **digest** like `nginx@sha256:...` is immutable. For reproducible deployments, pin images by digest:

```bash
docker buildx imagetools inspect nginx:latest
docker pull nginx@sha256:<digest>
```

This works much like Git's object store: content stored under its hash, and a tag as a name pointing at a hash.

## What Happens on docker run

With those pieces in place, here is what happens when you run:

```bash
docker run -d -p 8080:80 --memory 256m --name web nginx
```

1. **The CLI sends API requests** to dockerd over the Unix socket: create a container, then start it.
2. **dockerd checks for the image.** If `nginx:latest` is not present locally, it pulls it from the registry: manifest, config, and missing layers.
3. **The filesystem is prepared.** A new writable layer is created and an overlay mount combines it with the image layers.
4. **Networking is prepared.** Docker allocates an IP address on the default bridge network and sets up port publishing rules for 8080 to 80.
5. **dockerd asks containerd** to create and start the container, passing an OCI runtime spec built from the image config and your flags.
6. **containerd starts a shim**, and the shim invokes **runc** with the bundle (root filesystem plus `config.json`).
7. **runc creates the container**: it creates the namespaces (pid, net, mnt, uts, ipc), places the process into a new cgroup with `memory.max` set to 256 MiB, switches the root filesystem with `pivot_root`, mounts `/proc`, `/sys`, and `/dev`, drops capabilities, applies the seccomp profile, and finally calls `execve` on nginx's entrypoint.
8. **runc exits.** The nginx process is now PID 1 in its namespace, with the shim as its parent on the host.
9. **dockerd connects the network**: one end of a veth pair is moved into the container's network namespace as `eth0`.
10. **Logs are collected** from stdout and stderr through the logging driver (`json-file` by default).

The container runs until its PID 1 exits, whatever else is running inside.

## Networking

Each container gets its own network namespace, so by default it has no access to the host's interfaces. Docker connects it using network **drivers**.

### The Default Bridge

On installation, Docker creates a Linux bridge called **docker0**, typically with the address `172.17.0.1/16`. A bridge works like a virtual network switch.

For each container, Docker creates a **veth pair**: two virtual interfaces connected like a cable. One end goes into the container as `eth0`, the other stays on the host and is attached to `docker0`.

```
            Host network namespace
+----------------------------------------------------+
|   eth0 (host NIC, 192.168.1.10)                     |
|        ^                                            |
|        | iptables NAT (MASQUERADE / DNAT)           |
|        v                                            |
|   docker0 bridge (172.17.0.1)                       |
|      |                     |                        |
|   vethA                  vethB                      |
+------|---------------------|-----------------------+
       |                     |
   +---|--------+        +---|--------+
   |  eth0      |        |  eth0      |
   |  172.17.0.2|        |  172.17.0.3|
   |  web       |        |  db        |
   +------------+        +------------+
```

You can see these interfaces on the host:

```bash
ip link show type veth
ip addr show docker0
```

### Outbound Traffic and Port Publishing

Containers use private addresses, so Docker relies on **iptables** NAT rules (or nftables, depending on the setup):

- **Outbound**: a `MASQUERADE` rule rewrites the source address of packets leaving the bridge to the host's address, so replies come back to the host and are forwarded to the container.
- **Inbound**: `-p 8080:80` adds a `DNAT` rule in Docker's `DOCKER` chain that rewrites traffic arriving on host port 8080 to the container's IP on port 80.

```bash
sudo iptables -t nat -L DOCKER -n
```

```
Chain DOCKER (2 references)
target     prot opt source       destination
DNAT       tcp  --  0.0.0.0/0    0.0.0.0/0     tcp dpt:8080 to:172.17.0.2:80
```

One consequence surprises many people: published ports are handled by Docker's NAT rules before the host's normal `INPUT` rules, so a host firewall such as `ufw` may not block them. Bind to a specific address (for example `-p 127.0.0.1:8080:80`) when a port should only be reachable locally.

### DNS and User-Defined Networks

On the default bridge, containers can reach each other only by IP address. On a **user-defined bridge network**, Docker runs an embedded DNS server (at `127.0.0.11` inside each container) that resolves container names:

```bash
docker network create app-net
docker run -d --name db --network app-net postgres:17
docker run -d --name api --network app-net my-api
# inside "api", the hostname "db" resolves to the db container's IP
```

Docker Compose creates such a network for you, which is why services can refer to each other by name.

### Other Drivers

- **host**: shares the host's network namespace; no isolation, no NAT.
- **none**: only loopback.
- **macvlan / ipvlan**: an address directly on the physical network.
- **overlay**: spans hosts (Docker Swarm) using VXLAN.

## Volumes and Bind Mounts

The writable layer vanishes with the container and has copy-up overhead, so persistent or write-heavy data belongs outside it. Docker offers three options:

- **Volumes** are managed by Docker and stored under `/var/lib/docker/volumes/` on Linux. They are the preferred way to persist data such as database files.
- **Bind mounts** map a specific host path into the container. They're handy in development (mounting source code) but tie the container to the host's directory layout and permissions.
- **tmpfs mounts** live only in memory and vanish when the container stops.

```bash
docker volume create pgdata
docker run -d --name db -v pgdata:/var/lib/postgresql/data postgres:17   # volume
docker run --rm -v "$(pwd)":/src -w /src maven:3-eclipse-temurin-21 mvn package  # bind mount
docker run --rm --tmpfs /tmp:size=64m alpine df -h /tmp                  # tmpfs
```

All three are ordinary mounts that runc sets up in the mount namespace. They bypass OverlayFS, which is why databases should store data on a volume.

Watch file ownership with bind mounts: user IDs are just numbers shared with the host, so files a root container creates in a bind mount are owned by root on the host.

## Security

Since containers share the host kernel, Docker layers several kernel mechanisms to reduce what a container process can do.

### Capabilities

Linux splits root's powers into **capabilities**, such as `CAP_NET_BIND_SERVICE` (bind to ports below 1024), `CAP_CHOWN`, and `CAP_SYS_ADMIN` (a very broad set of administrative operations). Docker starts containers with a reduced default set. Root inside a container is therefore much weaker than real root, but still more powerful than necessary for most applications.

A good practice is to drop everything and add back only what is needed:

```bash
docker run --cap-drop ALL --cap-add NET_BIND_SERVICE nginx
```

The `--privileged` flag does the opposite: it grants all capabilities, gives access to host devices, and disables most other protections. Treat it as giving the container root on the host.

### Seccomp, AppArmor, and SELinux

**Seccomp** filters which system calls a process can make. Docker's default profile blocks risky, rarely needed ones, such as loading kernel modules or rebooting. **AppArmor** (Ubuntu, Debian) or **SELinux** (Red Hat family) adds mandatory access control on top.

The `--security-opt no-new-privileges` option stops processes from gaining privileges through setuid binaries.

### Running as a Non-Root User

Most images run as root (UID 0), and without user namespaces that is the host's UID 0, just constrained. A `USER` instruction is a simple improvement:

```dockerfile
RUN useradd --system --uid 10001 app
USER app
```

### Rootless Mode

In **rootless mode**, the Docker daemon itself runs as an unprivileged user, and containers use a **user namespace** so that root inside the container maps to that user's UID range on the host. Even if a process escapes the container, it has only the privileges of a normal user. It has some limitations, mainly around networking and some cgroup features. Podman, a Docker-compatible alternative, runs rootless by default.

### The Docker Socket

Access to `/var/run/docker.sock` equals root on the host, since anyone who can call the API can start a privileged container mounting `/`. Joining the `docker` group, or mounting the socket into a CI container, grants exactly that.

## Docker on macOS and Windows

Containers depend on Linux kernel features, so on macOS and Windows, **Docker Desktop runs a lightweight Linux virtual machine** and runs the Docker Engine inside it.

```
macOS / Windows host
+------------------------------------------------+
|  docker CLI  ----(socket forwarded)----+        |
|                                        v        |
|  +----------------------------------------+    |
|  |  Linux VM                              |    |
|  |  dockerd -> containerd -> runc         |    |
|  |  containers                            |    |
|  +----------------------------------------+    |
+------------------------------------------------+
```

- On **macOS**, the VM runs on Apple's Virtualization framework (older versions used HyperKit). On Apple Silicon, images are `linux/arm64` by default; `linux/amd64` images can run through emulation, more slowly.
- On **Windows**, Docker Desktop normally uses **WSL 2**, a real Linux kernel in a lightweight VM. Native Windows containers are a separate technology.

This explains why bind mounts are slower than on Linux (file access crosses the VM boundary, via VirtioFS on modern macOS setups), why container resources are capped by the VM's settings, and why Docker Desktop has to forward published ports from the host into the VM.

Alternatives such as Colima, OrbStack and Podman Desktop follow the same idea.

## Building a Mini Container by Hand

The best way to see that Docker is "just" kernel features is to build a rough container without it. This needs a Linux machine and root.

First, get a root filesystem. The easiest way is to export one from an existing image:

```bash
mkdir rootfs
docker export $(docker create alpine) | tar -C rootfs -xf -
```

Now start a shell in new namespaces using `unshare`, and switch its root directory with `chroot`:

```bash
sudo unshare --pid --fork --mount --uts --ipc --net chroot rootfs /bin/sh
```

Inside this shell:

```sh
mount -t proc proc /proc   # mount a fresh /proc for the new PID namespace
hostname mini              # changes only this UTS namespace
ps                         # only sh and ps are visible; sh is PID 1
ip link                    # only a loopback interface (lo), and it is down
```

`--pid --fork` makes the shell PID 1 in a new PID namespace, `--mount` keeps the `/proc` mount private, and `--uts`, `--ipc` and `--net` give it its own hostname, IPC objects and an empty network stack.

To add a resource limit, create a cgroup from another terminal on the host (cgroups v2, with the memory controller enabled for the parent group):

```bash
sudo mkdir /sys/fs/cgroup/mini
echo 100M | sudo tee /sys/fs/cgroup/mini/memory.max
echo <pid-of-the-shell-on-the-host> | sudo tee /sys/fs/cgroup/mini/cgroup.procs
```

That is a crude container: isolated processes, hostname, mounts, and network, with a memory limit. Production runtimes add `pivot_root` instead of `chroot` (which is easier to escape), an overlay, veth networking, dropped capabilities and seccomp. But the foundation is exactly what you just used.

## Java in Containers

The JVM sizes itself based on the resources it believes it has: the default maximum heap, the number of garbage collector threads, the size of the common `ForkJoinPool`, and more. Inside a container, "the resources it has" should mean the cgroup limits, not the host's.

### Container Awareness

Older JVMs read the host's memory and CPU count, so a JVM on a big host inside a small container picked a heap far too large and got OOM-killed. Modern JVMs are **container aware**:

- Java 10 added container support, and it was backported to Java 8u191.
- Support for cgroups v2 arrived in Java 15 and was backported to 11.0.16 and 8u372.

Older versions on a cgroups v2 host may silently fall back to host values.

You can see what the JVM detects:

```bash
docker run --rm --memory 1g --cpus 2 eclipse-temurin:21-jre java -XshowSettings:system -version
```

This prints the container's detected CPU and memory limits (on Linux). For more detail, `-Xlog:os+container=info` logs how the JVM reads its cgroup.

Or from inside an application:

```java
import java.lang.management.ManagementFactory;

public class ContainerInfo {
    public static void main(String[] args) {
        Runtime rt = Runtime.getRuntime();
        var os = (com.sun.management.OperatingSystemMXBean)
                ManagementFactory.getOperatingSystemMXBean();

        long mb = 1024 * 1024;
        System.out.println("Available processors: " + rt.availableProcessors());
        System.out.println("Max heap:             " + rt.maxMemory() / mb + " MB");
        System.out.println("Total memory (seen):  " + os.getTotalMemorySize() / mb + " MB");
    }
}
```

In a container started with `--memory 1g --cpus 2`, a modern JVM reports 2 processors, about 1,024 MB of total memory, and a max heap of roughly a quarter of that.

### Sizing the Heap

By default, the JVM's maximum heap is 25% of available memory (`-XX:MaxRAMPercentage=25`), which is conservative for a container that runs only one JVM. A common approach is to set a percentage instead of a fixed `-Xmx`, so the heap follows the container limit:

```dockerfile
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
```

Do not set it to 100%. The container's memory limit applies to the whole process, not just the heap. Metaspace, the code cache, thread stacks, GC data structures, direct buffers, and native libraries all count towards it. My virtual memory article goes into the difference between heap size and RSS in more detail; it is exactly what the cgroup limit is measured against.

`--cpus` shows up in `availableProcessors()`, which sizes GC threads and pools; override with `-XX:ActiveProcessorCount`.

### PID 1 and Signals

When Docker stops a container, it sends SIGTERM to PID 1, waits (10 seconds by default), then sends SIGKILL. Two things matter for Java applications:

- Use the **exec form** of `ENTRYPOINT` (the JSON array, as above). The shell form (`ENTRYPOINT java -jar app.jar`) runs `/bin/sh -c`, which becomes PID 1 and may not forward SIGTERM to the JVM, so shutdown hooks never run and the container is killed after the timeout.
- PID 1 also has to reap zombie processes. If your application spawns child processes, run the container with `--init`, which adds a tiny init process (tini) as PID 1.

## Common Mistakes

- **Treating containers as VMs**: running several services, SSH, and cron in one container. One main process per container keeps things simple.
- **Storing data in the container layer**: it disappears with the container and is slow under heavy writes. Use volumes.
- **Using `latest` in production**: pin versions or digests.
- **Deleting files in a later layer to "shrink" the image**: the data is still in the earlier layer. Clean up in the same `RUN` step, or use a multi-stage build.
- **Forgetting `.dockerignore`**: sending `.git` or `target` to the build slows it and can leak secrets.
- **Running as root and using `--privileged` casually**: drop capabilities and add a `USER`.
- **Publishing ports on all interfaces and trusting the host firewall**: Docker's NAT rules may bypass it. Bind to `127.0.0.1` when appropriate.
- **Setting `-Xmx` equal to the container memory limit**: the JVM needs memory beyond the heap, and the result is an OOM kill.
- **Using the shell form of `ENTRYPOINT`**: signals do not reach the application, so graceful shutdown fails.
- **Baking secrets into images**: anyone who can pull the image can extract them. Use build secrets instead.

## Cheat Sheet

| Concept | What it is | Where to look |
|---|---|---|
| Container | An isolated, limited Linux process | `ps -ef`, `docker top <name>` |
| dockerd | Docker daemon and API | `/var/run/docker.sock` |
| containerd | Container lifecycle and image content | `ctr`, `nerdctl` |
| shim | Per-container parent process | `ps -ef \| grep shim` |
| runc | OCI runtime that creates containers | `runc --help` |
| Namespaces | What a process can see | `/proc/<pid>/ns`, `lsns`, `nsenter` |
| Cgroups | What a process can use | `/sys/fs/cgroup`, `docker stats` |
| overlay2 | Layers merged into one filesystem | `docker inspect` (GraphDriver), `/var/lib/docker/overlay2` |
| Image layers | Filesystem changes per build step | `docker history <image>` |
| Manifest and digest | Content-addressed image description | `docker buildx imagetools inspect` |
| Bridge network | docker0 plus veth pairs plus NAT | `ip link`, `iptables -t nat -L` |
| Embedded DNS | Name resolution on user-defined networks | `127.0.0.11` |
| Volumes | Persistent storage outside the layers | `docker volume ls`, `/var/lib/docker/volumes` |
| Capabilities | Split root privileges | `--cap-drop ALL`, `--cap-add` |
| JVM container settings | Heap and CPU sizing from cgroups | `-XshowSettings:system`, `MaxRAMPercentage` |

## Conclusion

Docker's internals are a stack of fairly simple parts. The CLI talks to dockerd, which hands containers to containerd, which uses a shim and runc to start them. runc uses kernel namespaces to control what a process can see, cgroups to control what it can use, and capabilities, seccomp, and AppArmor or SELinux to limit what it can do. Images are content-addressed layers described by manifests, merged into a single root filesystem by OverlayFS, and shared through registries using an open standard.

Once you see a container as a regular Linux process with a few extra restrictions, everyday behaviour makes sense: why a container stops when PID 1 exits, why its files vanish without a volume, why a memory limit produces exit code 137, and why a JVM needs to know about cgroups.
