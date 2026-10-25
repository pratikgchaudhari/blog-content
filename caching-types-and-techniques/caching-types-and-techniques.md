---
title: Caching Explained - Types of Cache, Caching Strategies, and When to Use Each
date: 2026-10-25
summary: A detailed guide to caching, covering the different layers of cache, read and write strategies, eviction policies, invalidation, and common pitfalls, with a use case for each.
tag: caching, system-design, performance, redis, cdn, scalability, backend, distributed-systems
draft: false
---

A cache is a small, fast store that keeps copies of data so future requests for that data can be served more quickly. Instead of recomputing a result or fetching it again from a slower source, such as a database, a remote API, or a disk, the system returns the copy it already has.

Caching shows up at every level of computing. CPUs cache memory, operating systems cache disk blocks, browsers cache web pages, CDNs cache images and videos close to users, and applications cache database query results. The idea is always the same: keep frequently used data closer and in a faster medium, so you pay the expensive cost once and reuse the result many times.

Done well, caching can turn a 200 ms database query into a sub-millisecond memory lookup and let a system handle many times more traffic on the same hardware. Done badly, it serves stale data, hides bugs, and causes outages when it suddenly stops working. This article covers the different types of cache, the main caching strategies, and when each one is the right choice.

## Why Caching Works

Caching works because real workloads are rarely uniform. Two patterns make it effective:

- **Temporal locality**: data that was used recently is likely to be used again soon. A trending post, the logged-in user's profile, or today's exchange rate gets read over and over.
- **Spatial locality**: data near something that was just used is likely to be used next. Reading one element of an array often means reading the next ones too.

Most systems also follow some version of the 80/20 rule: a small fraction of the data receives most of the requests. If you cache that hot fraction, most requests never reach the slow backend.

### The Latency Gap

The benefit comes from the huge difference in speed between storage layers. Roughly:

| Operation | Approximate latency |
| --- | --- |
| CPU L1 cache reference | about 1 ns |
| CPU L2 cache reference | about 4 ns |
| Main memory (RAM) reference | about 100 ns |
| Read 1 MB sequentially from memory | about 3 microseconds |
| Read 1 MB sequentially from SSD | about 50 microseconds (NVMe) to 1 ms (SATA) |
| Round trip within a data centre | about 500 microseconds |
| Random read from a spinning disk | about 10 ms |
| Network round trip from India to the US and back | about 200 to 250 ms |

These are order-of-magnitude figures that vary by hardware, but the point holds: moving down the list, each tier is slower, often by orders of magnitude. A cache moves data up the list.

### Key Terms

- **Cache hit**: the requested data was found in the cache.
- **Cache miss**: it wasn't, so the system had to go to the original source (the **origin** or **backing store**).
- **Hit ratio**: hits divided by total requests. A 95% hit ratio means only 1 in 20 requests reaches the backend.
- **TTL (time to live)**: how long an entry is considered valid before it expires.
- **Eviction**: removing entries to make room when the cache is full.
- **Invalidation**: removing or updating entries because the underlying data changed.
- **Stale data**: a cached copy that no longer matches the source.

The effective latency of a cached system is roughly:

```
average latency = hit_ratio x cache_latency + (1 - hit_ratio) x origin_latency
```

With a 1 ms cache, a 100 ms database, and a 95% hit ratio, the average drops to about 5.95 ms. Raising the hit ratio to 99% brings it down to about 1.99 ms. Small improvements in hit ratio make a big difference.

## Types of Cache

Caches are usually described by where they sit between the user and the data. A single request can pass through many of them.

```
User -> Browser cache -> CDN / edge cache -> Load balancer / reverse proxy cache
     -> Application (in-process cache) -> Distributed cache (Redis, Memcached)
     -> Database (buffer pool, query cache) -> OS page cache -> Disk (with its own cache)
```

### 1. CPU Caches

**What it is:** Small, extremely fast memory built into the processor, organised in levels. L1 is the smallest and fastest (tens of KB per core), L2 is larger (hundreds of KB to a few MB), and L3 is shared between cores (tens of MB). Data moves between memory and cache in fixed-size **cache lines**, usually 64 bytes.

**Use case:** Every program benefits automatically, but performance-sensitive code (game engines, databases, numerical computing, high-frequency trading) is written to be cache-friendly. Iterating over a contiguous array is far faster than chasing pointers through a linked list, because the array's elements arrive in the cache together.

```java
// Cache-friendly: walks memory row by row, in the order it's laid out
for (int i = 0; i < n; i++)
    for (int j = 0; j < n; j++)
        sum += matrix[i][j];

// Cache-unfriendly: jumps to a different row on every step
for (int j = 0; j < n; j++)
    for (int i = 0; i < n; i++)
        sum += matrix[i][j];
```

On a large matrix, the first loop can run several times faster than the second, even though both do the same arithmetic.

### 2. Operating System Page Cache

**What it is:** The OS keeps recently read and written file data in otherwise unused RAM. The next read of the same file is served from memory instead of the disk. Writes usually go to the page cache first and are flushed to disk later.

**Use case:** It speeds up every file-based workload for free. Databases such as PostgreSQL rely on it heavily alongside their own buffer pool, and Kafka is designed to lean on it, so consumers reading recent messages almost never touch the disk. This is also why free memory on a busy Linux server usually shows up as "buff/cache" in `free -h`: the OS is using it as cache.

### 3. Browser (Client-Side) Cache

**What it is:** Web browsers store copies of responses (HTML, CSS, JavaScript, images, fonts, API responses) locally, controlled by HTTP caching headers.

```http
# Cache for one year; the file name changes when the content does
Cache-Control: public, max-age=31536000, immutable

# Always check with the server before reusing
Cache-Control: no-cache
ETag: "33a64df551425fcc55e4d42a148795d9f25f89d4"

# Never store (for sensitive data)
Cache-Control: no-store
```

When a cached response has expired but carries an `ETag` or `Last-Modified` header, the browser sends a **conditional request** (`If-None-Match` or `If-Modified-Since`). If nothing changed, the server replies `304 Not Modified` with no body, saving bandwidth.

**Use case:** Static assets such as bundled JavaScript, CSS, logos and fonts. The standard approach is to put a content hash in the file name (`app.3f9a1c.js`) and cache it for a year with `immutable`. A new deploy produces a new file name, so users always get the latest version without any manual invalidation. Browsers also offer programmatic storage, such as the Cache API used by service workers, `localStorage`, and IndexedDB, for offline-first apps.

### 4. CDN and Edge Caches

**What it is:** A Content Delivery Network (Cloudflare, Akamai, Amazon CloudFront, Fastly) is a network of servers spread around the world. Each **edge** location caches content from your origin server and serves it to nearby users.

**Use case:** Delivering images, video, downloads, static websites, and cacheable API responses to a global audience. A user in Mumbai gets the file from an edge server in Mumbai rather than from your origin in Virginia, cutting hundreds of milliseconds per request. CDNs also absorb traffic spikes and some DDoS attacks, since most requests never reach your servers.

CDNs read the same `Cache-Control` headers as browsers, plus CDN-specific ones like `s-maxage` (a TTL that applies only to shared caches):

```http
# Browsers cache for 60 seconds, the CDN for 1 hour
Cache-Control: public, max-age=60, s-maxage=3600
```

When content changes before its TTL runs out, you can **purge** it from the CDN through its API, or use **versioned URLs** so the old version simply stops being requested.

### 5. Reverse Proxy Cache

**What it is:** A server such as Nginx, Varnish, or HAProxy that sits in front of your application servers and caches their responses.

```nginx
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=app_cache:100m
                 max_size=10g inactive=60m;

server {
    location /api/products/ {
        proxy_cache app_cache;
        proxy_cache_valid 200 5m;
        proxy_cache_use_stale error timeout updating;
        proxy_pass http://app_servers;
    }
}
```

**Use case:** Caching whole pages or API responses that are the same for many users, such as a news homepage, a product catalogue, or public documentation, without changing application code. `proxy_cache_use_stale` also lets Nginx keep serving the last good response if the application is down or slow.

### 6. Application (In-Process) Cache

**What it is:** A cache that lives inside your application's own memory, such as a `HashMap`, Caffeine or Guava in Java, `functools.lru_cache` in Python, or a memoisation helper in JavaScript.

```java
// Java with Caffeine
Cache<Long, Product> productCache = Caffeine.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(Duration.ofMinutes(10))
        .recordStats()
        .build();

Product product = productCache.get(productId, id -> productRepository.findById(id));
```

```python
from functools import lru_cache

@lru_cache(maxsize=1024)
def get_exchange_rate(currency: str) -> float:
    return fetch_rate_from_api(currency)
```

**Use case:** Data that is read constantly, changes rarely, and is small enough to fit in each server's memory: configuration, feature flags, country and currency lists, compiled templates, or permission rules. Lookups are nanoseconds because there's no network hop and no serialisation.

**Trade-offs:** Each application instance has its own copy, so instances can disagree for a while after data changes. The cache is lost on every restart or deploy, and its memory competes with the application's heap. For data that must be consistent across servers, use a distributed cache instead, or combine the two.

### 7. Distributed Cache

**What it is:** A separate cache service shared by all application instances over the network. **Redis** and **Memcached** are the most common, along with managed versions like Amazon ElastiCache, plus Hazelcast and Apache Ignite in the Java world.

```python
import json
import redis

r = redis.Redis(host="cache.internal", port=6379)

def get_user(user_id: int) -> dict:
    key = f"user:{user_id}"
    cached = r.get(key)
    if cached:
        return json.loads(cached)

    user = db.fetch_user(user_id)
    r.set(key, json.dumps(user), ex=600)   # expire after 10 minutes
    return user
```

**Use case:** Sharing cached data across many servers: user sessions, user profiles, shopping carts, rate-limit counters, leaderboards, and the results of expensive queries or API calls. Every instance sees the same value, and the cache survives application restarts.

**Redis vs Memcached:**

- **Memcached** is a simple, multi-threaded key-value store for strings. It's very fast and easy to scale horizontally, and suits plain object caching.
- **Redis** supports rich data structures (hashes, lists, sets, sorted sets, streams), atomic operations, Lua scripting, optional persistence, replication, and clustering. That makes it useful well beyond plain caching, for counters, queues, leaderboards, and distributed locks.

Distributed caches scale by splitting keys across nodes, usually with **consistent hashing** (or Redis Cluster's fixed hash slots), so adding or removing a node only moves a small share of the keys.

### 8. Database Caches

**What it is:** Databases have their own internal caches:

- The **buffer pool** (InnoDB) or **shared buffers** (PostgreSQL) keeps frequently accessed table and index pages in memory.
- **Plan caches** store compiled query plans so repeated queries skip parsing and planning. Prepared statements make good use of this.
- **Materialised views** store the precomputed result of a query as a table that can be refreshed periodically.

MySQL used to have a query result cache, but it was removed in MySQL 8.0 because invalidating it on every write made it a bottleneck under concurrency.

```sql
-- PostgreSQL: precompute a heavy daily report
CREATE MATERIALIZED VIEW daily_sales AS
SELECT date_trunc('day', created_at) AS day, sum(total) AS revenue, count(*) AS orders
FROM orders
GROUP BY 1;

-- Refresh without blocking readers (requires a unique index on the view)
REFRESH MATERIALIZED VIEW CONCURRENTLY daily_sales;
```

**Use case:** Sizing the buffer pool so the working set fits in memory is one of the most effective database tuning steps. Materialised views suit dashboards and reports that aggregate large amounts of data and can tolerate results being a few minutes old.

### 9. DNS Cache

**What it is:** Resolved domain names are cached by the browser, the operating system, and DNS resolvers, each for as long as the record's TTL allows.

**Use case:** Avoiding a DNS lookup on every request. Before a planned migration, teams usually lower the DNS TTL from hours to a minute or so in advance, so the switch to a new IP address takes effect quickly.

### 10. Disk and Hardware Caches

**What it is:** SSDs and hard drives have their own onboard memory caches, and RAID controllers often have battery-backed write caches. On the storage side, hybrid setups use fast SSDs to cache slower spinning disks.

**Use case:** Mostly invisible to applications, but important for databases. A volatile write cache that lies about having flushed data to disk can cause data loss on power failure, which is why databases rely on `fsync` and storage with proper power-loss protection.

## Caching Strategies (Read and Write Patterns)

Choosing where to cache is half the problem. The other half is how the cache and the database stay in sync on reads and writes.

### Cache-Aside (Lazy Loading)

The application manages the cache itself. On a read, it checks the cache first. On a miss, it loads the data from the database and puts it in the cache. On a write, it updates the database and deletes (invalidates) the cached entry.

```python
def get_product(product_id):
    key = f"product:{product_id}"
    product = cache.get(key)
    if product is None:                       # cache miss
        product = db.get_product(product_id)
        cache.set(key, product, ttl=300)
    return product

def update_product(product_id, data):
    db.update_product(product_id, data)
    cache.delete(f"product:{product_id}")     # next read reloads fresh data
```

**Pros:** Only data that is actually requested gets cached. If the cache goes down, the application still works, just more slowly.

**Cons:** The first request for any item is always a miss. There's a window where the cache and database can disagree, and concurrent reads and writes can occasionally put stale data back into the cache.

**Use case:** The default choice for most read-heavy applications, such as product pages, user profiles, and article content. Deleting the key on write is generally safer than updating it, because two concurrent updates can otherwise leave the older value in the cache.

### Read-Through

Similar to cache-aside, except the cache itself loads missing data from the database through a configured loader. The application only ever talks to the cache.

```java
// Caffeine LoadingCache: the cache calls the loader on a miss
LoadingCache<Long, Product> products = Caffeine.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(Duration.ofMinutes(5))
        .build(id -> productRepository.findById(id).orElse(null));

Product p = products.get(42L);
```

**Use case:** Keeping caching logic out of business code, especially with libraries or caching providers that support loaders (Caffeine, Hazelcast, Ehcache, or Spring's `@Cacheable`). Many loading caches also make sure only one load happens per key when many requests miss at once.

### Write-Through

Every write goes to the cache and the database together, synchronously. The write only succeeds once both are updated.

```python
def update_user(user_id, data):
    db.update_user(user_id, data)
    cache.set(f"user:{user_id}", data, ttl=3600)
```

**Pros:** The cache always has fresh data for anything that's been written, so reads right after writes are fast and consistent.

**Cons:** Writes are slower, since they touch two systems. The cache fills up with data that may never be read.

**Use case:** Data that is read soon and often after being written, where reading stale values is unacceptable, such as user settings, account balances shown right after a transaction, or session data. Often combined with read-through.

### Write-Behind (Write-Back)

Writes go to the cache immediately and are acknowledged. The cache writes them to the database later, asynchronously, often in batches.

```
Client --write--> Cache (ack immediately)
                    |
                    +--(batched, async)--> Database
```

**Pros:** Very fast writes and much less load on the database, because many updates to the same key can be combined into one.

**Cons:** If the cache node fails before flushing, those writes are lost. The database lags behind the cache, which complicates anything else that reads the database directly.

**Use case:** High-volume writes where losing a small amount of recent data is acceptable or can be recovered: view counters, likes, analytics events, game state, or IoT sensor readings. CPU caches and OS page caches use write-back as well.

### Write-Around

Writes go straight to the database, bypassing the cache. Data is only cached when it's later read (usually via cache-aside).

**Use case:** Data that's written once and rarely read soon afterwards, such as logs, audit records, chat history archives, or bulk imports. It stops the cache from filling up with entries nobody will request.

### Refresh-Ahead

The cache proactively reloads popular entries shortly **before** they expire, so readers never experience a miss on hot keys.

```java
LoadingCache<String, Rates> rates = Caffeine.newBuilder()
        .refreshAfterWrite(Duration.ofMinutes(4))   // reload in the background
        .expireAfterWrite(Duration.ofMinutes(5))    // hard expiry
        .build(key -> ratesApi.fetch(key));
```

**Use case:** Hot data with predictable access that is expensive to compute, such as exchange rates, homepage recommendations, configuration fetched from a remote service, or leaderboard snapshots. It works badly for data that's rarely requested, because it wastes work refreshing entries nobody reads.

### Strategy Comparison

| Strategy | Read path | Write path | Best for |
| --- | --- | --- | --- |
| Cache-aside | App checks cache, loads on miss | App writes DB, deletes key | General read-heavy workloads |
| Read-through | Cache loads on miss | Usually paired with another strategy | Cleaner code, single-flight loading |
| Write-through | Always fresh | Cache and DB synchronously | Read-after-write consistency |
| Write-behind | Always fresh in cache | Cache now, DB later | Very high write volume |
| Write-around | Loads on miss | DB only | Write-once, read-rarely data |
| Refresh-ahead | Reloaded before expiry | Any | Hot, expensive, predictable keys |

## Eviction Policies

A cache has limited memory. When it's full, it has to decide what to throw out. The right policy depends on your access pattern.

### LRU (Least Recently Used)

Evicts the entry that hasn't been accessed for the longest time. It's simple and works well whenever recently used data is likely to be used again. It's usually implemented with a hash map plus a doubly linked list, giving constant-time gets and puts.

```java
// A tiny LRU cache in Java using LinkedHashMap's access order
class LruCache<K, V> extends LinkedHashMap<K, V> {
    private final int capacity;

    LruCache(int capacity) {
        super(capacity, 0.75f, true);   // true = order by access, not insertion
        this.capacity = capacity;
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > capacity;
    }
}
```

**Use case:** The default for most application and web caches, such as user sessions, recently viewed products, and API responses. Its weakness is that a one-off scan through lots of data can push out genuinely popular items.

### LFU (Least Frequently Used)

Evicts the entry with the fewest accesses. Popular items stay even if they weren't touched in the last few seconds. Practical implementations decay counts over time so that items which were popular yesterday don't stay forever.

**Use case:** Workloads with a stable set of popular items, such as a catalogue's best-selling products, or CDN content where some files are consistently in demand.

### FIFO (First In, First Out)

Evicts the oldest entry by insertion time, regardless of how often it's used. It's cheap but usually performs worse than LRU.

**Use case:** Simple caches where recency of insertion roughly matches usefulness, or as a building block for more advanced algorithms.

### Random Replacement

Evicts a random entry. Surprisingly, it performs reasonably well in some workloads and needs no bookkeeping.

**Use case:** Very large caches or hardware caches where tracking access order is too expensive.

### TTL-Based Expiry

Strictly an expiry policy rather than eviction, but often the main way entries leave a cache. Each entry has a lifetime and is removed when it runs out.

**Use case:** Bounding staleness. Even if you invalidate on writes, a TTL acts as a safety net that guarantees a stale value can't live forever.

### Modern Adaptive Policies

Newer algorithms combine recency and frequency to get the best of both:

- **ARC** (Adaptive Replacement Cache) balances between a recency list and a frequency list based on the workload. ZFS uses it.
- **W-TinyLFU** puts new entries in a small LRU window, then only admits them to the main cache if a compact frequency sketch shows they're more popular than what they'd replace. Caffeine uses it and achieves near-optimal hit ratios across many workloads.
- **S3-FIFO** and **SIEVE** are recent FIFO-based designs that achieve hit ratios comparable to or better than LRU with simpler, more scalable implementations.

### Redis Eviction Policies

Redis lets you choose the policy with `maxmemory-policy`:

```conf
maxmemory 4gb
maxmemory-policy allkeys-lru
```

| Policy | Behaviour |
| --- | --- |
| `noeviction` | Reject writes when memory is full (the default) |
| `allkeys-lru` | Evict any key, least recently used first |
| `allkeys-lfu` | Evict any key, least frequently used first |
| `volatile-lru` | Evict only keys with a TTL, least recently used first |
| `volatile-lfu` | Evict only keys with a TTL, least frequently used first |
| `volatile-ttl` | Evict keys with the shortest remaining TTL first |
| `allkeys-random` / `volatile-random` | Evict random keys |

For a pure cache, `allkeys-lru` or `allkeys-lfu` is usually right. If the same Redis instance also holds data that must never be evicted, use a `volatile-*` policy and only set TTLs on cache keys, or better, run separate instances.

## Cache Invalidation

> "There are only two hard things in Computer Science: cache invalidation and naming things." — Phil Karlton

The hard part of caching isn't storing data. It's knowing when the stored copy is wrong. Common approaches:

### Time-Based Expiry (TTL)

Every entry expires after a fixed time. It's simple and self-healing, but data can be stale for up to the TTL.

**Use case:** Data where some staleness is fine, such as product listings, recommendations, weather, or trending lists. Choose the TTL based on how stale the data is allowed to be, not on how often it changes.

### Explicit Invalidation on Write

Delete or update the cache entry whenever the data changes, as in cache-aside.

**Use case:** Data that must reflect changes quickly, such as a user editing their profile. Pair it with a TTL as a safety net in case an invalidation is missed.

### Event-Driven Invalidation

Publish change events (through Kafka, Redis Pub/Sub, or a database change-data-capture tool like Debezium) and have caches invalidate themselves when they receive one.

```python
# Each app instance listens for invalidation messages and clears its local cache
pubsub = r.pubsub()
pubsub.subscribe("invalidate:product")

for message in pubsub.listen():
    if message["type"] == "message":
        local_cache.pop(message["data"].decode(), None)
```

**Use case:** Keeping many in-process caches, or caches in several services, consistent with a single source of truth. Change-data-capture is especially robust because it catches every change made to the database, including ones that bypass the application.

### Versioned Keys

Include a version number or content hash in the cache key. When data changes, bump the version, and the old entries simply age out.

```python
version = cache.get("catalog:version") or 1
key = f"catalog:v{version}:category:{category_id}"

# When the catalogue is updated
cache.incr("catalog:version")
```

**Use case:** Invalidating large groups of related entries at once (everything under a category, or every page for a tenant) without having to find and delete each key. Hashed asset file names in browser caching work the same way.

## Common Caching Problems and How to Solve Them

### Cache Stampede (Thundering Herd)

When a popular key expires, hundreds of requests can miss at the same moment and all hit the database to rebuild the same value, sometimes overwhelming it.

Solutions:

- **Locking or request coalescing ("single flight")**: let only one request rebuild the value while the others wait for it or receive the stale value.

  ```python
  def get_with_lock(key, loader, ttl=300):
      value = cache.get(key)
      if value is not None:
          return value
      # Only one caller wins the lock; it expires in 10 s in case the holder crashes
      if cache.set(f"lock:{key}", "1", nx=True, ex=10):
          try:
              value = loader()
              cache.set(key, value, ex=ttl)
              return value
          finally:
              cache.delete(f"lock:{key}")
      time.sleep(0.05)
      return get_with_lock(key, loader, ttl)
  ```

- **Refresh-ahead or probabilistic early expiry**: refresh the value slightly before it expires, with each request having a small, increasing chance of triggering the refresh as expiry approaches.
- **Serve stale while revalidating**: return the expired value immediately and refresh it in the background. HTTP supports this with `Cache-Control: stale-while-revalidate=60`.

### Cache Avalanche

Many keys expire at the same time, often because they were all loaded together after a deploy or a cache restart, causing a sudden flood of database traffic.

Solutions:

- **Add jitter to TTLs**, so entries expire at slightly different times:

  ```python
  ttl = 3600 + random.randint(0, 300)
  ```

- **Warm the cache** before sending traffic to a new or restarted cache.
- Protect the database with rate limiting or circuit breakers, and use a highly available cache setup (replicas, Redis Sentinel or Cluster) so a single node failure doesn't empty the cache.

### Cache Penetration

Requests for data that doesn't exist (for example, random or malicious IDs) always miss the cache and always hit the database, because there's nothing to cache.

Solutions:

- **Cache negative results**: store a "not found" marker with a short TTL.
- **Use a Bloom filter**: a compact structure that can tell you an ID definitely doesn't exist, so the request can be rejected before reaching the cache or database.
- **Validate input** early, such as rejecting IDs in an impossible format.

### Hot Keys

A single extremely popular key (a celebrity's profile, a flash-sale product) can overload the one cache node that holds it.

Solutions:

- Add a small **in-process cache** in front of the distributed cache for that key.
- **Replicate** the hot key under several names (`product:42:copy1`, `product:42:copy2`, ...) and spread reads across them.
- Use read replicas of the cache node.

### Stale Data and Race Conditions

A classic race in cache-aside:

1. Request A misses the cache and reads the old value from the database.
2. Request B updates the database and deletes the cache key.
3. Request A writes the old value it read into the cache.

Now the cache holds stale data until the TTL expires. Mitigations include keeping TTLs reasonably short, **delayed double delete** (delete again a short time after the write), using version numbers or timestamps so an older value can't overwrite a newer one, and driving invalidation from database change events.

### Cold Start

A freshly started or flushed cache has a hit ratio of zero, and the database takes the full load until it fills.

**Solution:** Warm the cache by preloading the most popular keys at startup, roll out new cache nodes gradually, and avoid flushing the whole cache in production.

## What to Cache and What Not To

**Good candidates:**

- Data that is read far more often than it's written.
- Results that are expensive to compute or fetch, such as aggregations, rendered pages, third-party API responses, and ML inference results.
- Data that can tolerate being slightly out of date.
- Data that is the same for many users.

**Poor candidates:**

- Data that changes on almost every read.
- Data that must always be perfectly accurate, such as inventory at checkout or a bank balance used for a transfer decision, unless you have a strict consistency strategy.
- Highly personalised data with little reuse, where the hit ratio will be low.
- Sensitive data, unless it's encrypted and access-controlled. Never let a shared cache (CDN or proxy) store a response that contains one user's private data, and mark such responses `Cache-Control: private` or `no-store`.

## Caching in Spring Boot

Many frameworks build these patterns in. In Spring Boot, caching is a set of annotations backed by a provider such as Caffeine or Redis:

```java
@Configuration
@EnableCaching
public class CacheConfig { }

@Service
public class ProductService {

    // Cache-aside on read: returns the cached value if present
    @Cacheable(value = "products", key = "#id")
    public Product getProduct(Long id) {
        return productRepository.findById(id).orElseThrow();
    }

    // Write-through style: update the database, then put the new value in the cache
    @CachePut(value = "products", key = "#product.id")
    public Product updateProduct(Product product) {
        return productRepository.save(product);
    }

    // Invalidate on delete
    @CacheEvict(value = "products", key = "#id")
    public void deleteProduct(Long id) {
        productRepository.deleteById(id);
    }
}
```

```yaml
# application.yml
spring:
  cache:
    type: redis
    redis:
      time-to-live: 10m
  data:
    redis:
      host: localhost
      port: 6379
```

One common gotcha: these annotations work through proxies, so calling a `@Cacheable` method from another method in the same class bypasses the cache.

## Monitoring a Cache

A cache you don't measure is a cache you can't trust. Track:

- **Hit ratio**, overall and per key pattern. A falling hit ratio often signals a bug or a changed access pattern.
- **Latency** of cache operations, including tail latency (p99).
- **Memory usage and evictions.** A high eviction rate means the cache is too small for the working set.
- **Key count and size distribution**, to spot unexpectedly large values.
- **Backend load**, to confirm the cache is actually protecting the database.

```bash
# Redis: hits, misses, and evictions
redis-cli INFO stats | grep -E 'keyspace_hits|keyspace_misses|evicted_keys'

# Find the biggest keys
redis-cli --bigkeys

# Find the most frequently accessed keys (requires an LFU eviction policy)
redis-cli --hotkeys
```

## Conclusion

Caching is about putting the right data in the right place at the right time. The type of cache decides *where* data lives: in the CPU, the OS, the browser, the CDN, a reverse proxy, the application's memory, a distributed store like Redis, or the database itself. The strategy decides *how* it stays in sync with the source: cache-aside for general read-heavy workloads, write-through for read-after-write consistency, write-behind for heavy write volumes, write-around for write-once data, and refresh-ahead for hot keys that must never miss.

Around those choices sit eviction policies, invalidation, and defences against stampedes, avalanches, penetration, and hot keys. Start with the simplest thing that works, usually cache-aside with a sensible TTL, measure the hit ratio, and add sophistication only where the numbers show you need it. A well-designed cache is invisible to users. They just notice that everything is fast.
