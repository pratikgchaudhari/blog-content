---
title: Bloom Filters Explained - Bit Arrays, Hashing, False Positives and Membership Queries
date: 2026-11-14
summary: A detailed guide to Bloom filters covering membership queries, false-positive probability, sizing, double hashing, Java and Guava implementations, deletion, scalable filters, alternatives, and storage applications.
tag: bloom-filter, probabilistic-data-structures, hashing, databases, caching, distributed-systems, java
draft: false
related: lsm-trees-explained,how-inverted-indexes-work,b-trees-explained,database-internals,caching-types-and-techniques
---

A **Bloom filter** is a compact data structure for answering whether an item might belong to a set. It stores a bit array rather than the items themselves. A lookup returns either **definitely absent** or **possibly present**. The second answer requires confirmation if the application needs exact membership.

Burton H. Bloom introduced the idea in his 1970 paper, *Space/Time Trade-offs in Hash Coding with Allowable Errors*. The proposal allowed a small probability of error in exchange for substantially less storage than an exact representation. That trade remains useful when a cheap negative answer can avoid a database lookup, a disk read, or a network request.

Bloom filters appear in storage engines, distributed query execution, and caching systems. Their value comes from eliminating unnecessary work, not from replacing the authoritative data. This article explains how they work, how to size them, and where the guarantee can fail in an implementation even though the underlying mathematics has only one-sided error.

## Why Approximate Membership Helps

An exact set must retain enough information to distinguish its members. A Java `HashSet<String>` stores references and table metadata in addition to the strings. A sorted database index stores keys and record references, and accessing it may involve storage I/O.

A Bloom filter represents membership using a fixed number of bits. It cannot enumerate its members, retrieve associated values, or explain which inserted item set a bit. Those limitations make it much smaller, but also mean it cannot give a definitive positive answer.

The useful arrangement is:

```
Incoming key
     |
     v
Bloom filter ---- definitely absent ----> skip expensive lookup
     |
     | possibly present
     v
Exact database / file / service
     |
     v
Authoritative answer
```

This is worthwhile when negative lookups are common and the exact check is expensive. If almost every key exists, the filter usually adds work before an operation that must happen anyway.

## The Bit Array and Hash Probes

A standard filter has three parameters:

- **`m`**: the number of bits in its array.
- **`n`**: the number of distinct keys inserted, or the expected capacity when sizing it.
- **`k`**: the number of bit positions examined per key.

Initially every bit is zero. To insert a key, hash it to `k` positions and set those bits to one. To query a key, compute the same positions and inspect them.

```
insert(key):
    for each of k positions:
        bits[position] = 1

mightContain(key):
    for each of k positions:
        if bits[position] == 0:
            return false
    return true
```

Different keys can share positions. A single key can also produce the same position more than once, depending on the hashing scheme. The data structure does not require each key to own distinct bits, although poor probe generation can make collisions unnecessarily frequent.

Insertion only changes zero to one. Inserting a duplicate key does not change the array after its positions are already set. Its effect on occupancy depends on distinct key patterns, not the number of API calls.

## Inserting and Looking Up a Key Step by Step

Use a tiny array with 16 bits and three probes per key. The following positions are illustrative outputs, selected to make the bit operations visible:

| Key | Positions |
|---|---|
| apple | 1, 5, 9 |
| pear | 5, 10, 14 |
| plum | 2, 7, 12 |
| mango | 1, 10, 14 |

Insert `apple`, then `pear`:

```
Position:      0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15
Initially:     0 0 0 0 0 0 0 0 0 0  0  0  0  0  0  0
After apple:   0 1 0 0 0 1 0 0 0 1  0  0  0  0  0  0
After pear:    0 1 0 0 0 1 0 0 0 1  1  0  0  0  1  0
```

Now query three keys:

1. **`apple`** checks 1, 5, and 9. All are set, so the answer is possibly present. In this case it was inserted.
2. **`plum`** checks 2, 7, and 12. Position 2 is zero, so it is definitely absent. The lookup can stop there.
3. **`mango`** checks 1, 10, and 14. All are set even though mango was never inserted. This is a **false positive**.

Mango does not need to collide completely with one inserted key. Its positions are covered collectively by bits set by different members. That is why storing more keys gradually increases the false-positive rate.

## False Positives and the No-False-Negative Guarantee

For an inserted key, insertion set every position that lookup will inspect. Because standard insertion never clears bits, those positions remain set. That is the reason a standard Bloom filter has **no false negatives** for successfully inserted members.

The guarantee has implementation conditions:

- Insertions and lookups must use identical key bytes and hash parameters.
- The filter must include every key covered by the authoritative dataset version.
- Bits must not be lost through concurrent updates, corruption, or unsafe deletion.
- Readers must observe completed insertions according to the concurrency contract.

For example, building a filter from yesterday's database does not make it safe to reject today's newly added keys. This is a stale-index problem, not a mathematical false positive or a contradiction of the filter's model.

A positive answer must also be interpreted carefully. A false-positive probability of 1% does not mean that 99% of positive answers are correct. The fraction of positive answers that are wrong depends on how often queries actually concern absent keys. Workload prevalence matters as much as the filter's error rate.

## False-Positive Probability

### How Bits Become Occupied

Under the usual idealized model, each probe chooses a uniform independent position. One probe misses a particular bit with probability `1 - 1/m`. After `k * n` probes, the probability that bit remains zero is:

```
P(bit is zero) = (1 - 1/m) ^ (k * n)
              ≈ exp(-k * n / m)
```

The approximation becomes useful for large arrays. The probability a bit is set is therefore approximately `1 - exp(-k*n/m)`. An absent key is a false positive when all its probes encounter set bits:

```
p ≈ (1 - exp(-k * n / m)) ^ k
```

This is a standard approximation, not an exact universal expression for every finite filter and hashing strategy. Probe dependence, rounding, small arrays, and uneven hashes affect the actual probability.

### Choosing the Number of Probes

More probes help only up to a point. They check more evidence during lookup, but insertion also fills more bits. The approximate optimum for a fixed bit budget is:

```
k ≈ (m / n) * ln(2)
```

Choose an integer near this value and compare nearby choices when precision matters. At the mathematical optimum, roughly half the bits are set. Extra probes beyond that balance can increase the error rate while also consuming more CPU.

Let `r = m/n`, the **bits per key**. The sizing relationship for target false-positive probability `p` is:

```
m ≈ -n * ln(p) / (ln(2) * ln(2))
r ≈ -ln(p) / (ln(2) * ln(2))
```

Here `ln` means natural logarithm. These formulas use bits, not bytes. Divide by eight to estimate the raw byte array, then account for headers, alignment, hash metadata, and any implementation-specific rounding.

### A Sizing Table

The following values use the approximate probability formula with the shown integer probe count:

| Bits per Key (`m/n`) | Integer `k` | Approximate False Positives |
|---:|---:|---:|
| 4 | 3 | 14.6892% |
| 6 | 4 | 5.6057% |
| 8 | 6 | 2.1577% |
| 10 | 7 | 0.8194% |
| 12 | 8 | 0.3142% |
| 16 | 11 | 0.0459% |

A 1% target needs about `9.5851` bits per key before rounding. For one million expected distinct keys, that is about 9.585 million bits, or 1.198 million bytes of raw bit storage. This is a calculation, not a memory measurement of a Java object.

Capacity errors are expensive. A filter allocated at ten bits per expected key with seven probes has an estimated error rate near 0.82% at capacity. Inserting twice as many distinct keys gives only five bits per actual key; with the original seven probes, the estimate rises to about 13.78%. The filter still has no false negatives under its normal conditions, but becomes less useful.

### Interpreting a Positive Answer

Consider a hypothetical batch of 10,000 lookups where only 100 keys are actual members. At a 1% false-positive rate, the 9,900 absent-key lookups produce about 99 false positives in expectation. The 100 actual members also produce positive answers. Of the roughly 199 expected positives, about half are therefore false, despite the filter having a 1% false-positive rate.

These are stipulated inputs for a probability example, not workload statistics. They show why a filter's positive answer cannot be treated as a confidence score. If the membership prevalence changes, the interpretation of that answer changes even when the filter itself stays identical.

For performance planning, let `a` be the fraction of queries for absent keys and `p` the false-positive probability. The approximate fraction of exact lookups avoided is `a * (1 - p)`. If half the queries concern absent keys and `p = 0.01`, the filter avoids about 49.5% of exact lookups. That benefit must outweigh hashing, cache misses, memory, and maintenance costs.

## Double Hashing

Computing a separate expensive hash for every position is unnecessary. **Kirsch and Mitzenmacher** analyzed generating probes from two base hashes:

```
position(i) = (h1(key) + i * h2(key)) mod m
for i = 0, 1, ..., k - 1
```

Their work, *Less Hashing, Same Performance: Building a Better Bloom Filter*, establishes that this approach can preserve the asymptotic false-positive performance under its assumptions. That is not a claim that any arbitrary pair of weak hash functions will work well.

The arithmetic needs care. If `m` is a power of two and the step is even, the sequence can visit only part of the array. Using an odd step makes it relatively prime to that array size. More generally, the relationship between step and modulus affects the positions visited.

Stable serialization matters too. Hashing a username with one normalization during insertion and another during lookup can create false negatives. Cross-language systems need a specified encoding, byte order, hash algorithm, seed, and probe-generation convention.

## A Complete Java Implementation

This implementation stores strings, derives two 64-bit values from a SHA-256 digest, and generates positions using double hashing. The array size is rounded up to a power of two, so an odd step traverses the whole modular space. The resulting allocation can be larger than the formula's minimum.

```java
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.BitSet;
import java.util.Objects;

public final class StringBloomFilter {
    private final int bitSize;
    private final int mask;
    private final int probes;
    private final BitSet bits;

    public StringBloomFilter(long expectedKeys, double targetProbability) {
        if (expectedKeys <= 0 || !Double.isFinite(targetProbability)
                || targetProbability < 1e-9 || targetProbability >= 1) {
            throw new IllegalArgumentException("Invalid capacity or probability");
        }
        double ln2 = Math.log(2);
        double wanted = Math.ceil(-expectedKeys * Math.log(targetProbability)
                                 / (ln2 * ln2));
        if (wanted > (1L << 30)) {
            throw new IllegalArgumentException("Filter exceeds this implementation's limit");
        }
        int size = 64;
        while (size < wanted) size <<= 1;
        this.bitSize = size;
        this.mask = size - 1;
        this.probes = Math.max(1,
                (int) Math.round((double) size / expectedKeys * ln2));
        this.bits = new BitSet(size);
    }

    private long[] hashes(String key) {
        Objects.requireNonNull(key, "key");
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(key.getBytes(StandardCharsets.UTF_8));
            ByteBuffer buffer = ByteBuffer.wrap(bytes);
            long first = buffer.getLong();
            long step = buffer.getLong() | 1L;
            return new long[]{first, step};
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    public synchronized void put(String key) {
        long[] hash = hashes(key);
        for (int i = 0; i < probes; i++) {
            int position = (int) (hash[0] + i * hash[1]) & mask;
            bits.set(position);
        }
    }

    public synchronized boolean mightContain(String key) {
        long[] hash = hashes(key);
        for (int i = 0; i < probes; i++) {
            int position = (int) (hash[0] + i * hash[1]) & mask;
            if (!bits.get(position)) return false;
        }
        return true;
    }

    public int bitSize() { return bitSize; }
    public int probes() { return probes; }

    public static void main(String[] args) {
        StringBloomFilter filter = new StringBloomFilter(100_000, 0.01);
        filter.put("apple");
        filter.put("pear");
        System.out.println(filter.mightContain("apple")); // true
        System.out.println(filter.mightContain("plum"));  // false or true
    }
}
```

The constructor accepts targets from `1e-9` up to, but excluding, one and caps storage at `2^30` bits. These are implementation limits. The minimum allocation is 64 bits, and the probe count is recomputed from actual allocation rather than the unrounded request.

Java's defined integer overflow is intentional in probe arithmetic. Masking retains the low bits needed for a power-of-two modulus, even if the intermediate signed `long` overflows. There is no use of `Math.abs`, which would mishandle the most negative signed integer.

Both public operations are synchronized so insertions cannot lose bit updates and completed writes are visible to subsequent lookups. `BitSet` alone does not provide that guarantee. Coarse locking is simple but limits concurrency. Atomic words or partitioned designs can improve throughput with a more careful concurrency contract.

SHA-256 makes the example self-contained using the standard library, but it is not the cheapest choice for a high-throughput filter. A production library commonly uses efficient non-cryptographic hashing. This implementation also has no persistence, union operation, occupancy estimator, or resizing mechanism.

## Using Guava's BloomFilter

For application code, a maintained library avoids many details of allocation and hashing. The [Guava API](https://guava.dev/releases/33.4.8-jre/api/docs/com/google/common/hash/BloomFilter.html) provides **`BloomFilter<T>`**, with a **funnel** describing how objects become bytes:

```java
import com.google.common.hash.BloomFilter;
import com.google.common.hash.Funnels;
import java.nio.charset.StandardCharsets;

BloomFilter<CharSequence> filter = BloomFilter.create(
        Funnels.stringFunnel(StandardCharsets.UTF_8),
        1_000_000L,
        0.01);

filter.put("customer:42");

if (filter.mightContain("customer:42")) {
    // Consult the authoritative store before reporting membership.
}

double estimatedError = filter.expectedFpp();
long estimatedCount = filter.approximateElementCount();
```

`expectedFpp()` estimates the probability from the current filter state; it is not a guarantee about the fraction of positive answers that are wrong. `approximateElementCount()` is an estimate, not an exact distinct counter.

For custom objects, define a stable funnel over the fields that determine membership. A changing `toString()` representation is a poor serialization contract. When combining filters with `putAll`, compatibility includes size, probe strategy, and funnel semantics. Persisted filters also need format and application-version compatibility.

## Why Ordinary Deletion Is Unsafe

Suppose apple and pear both set bit 5 in the step-by-step example. Clearing apple's bits to remove it would clear bit 5, even though pear still needs that bit. A later lookup could wrongly reject pear.

A standard filter therefore cannot delete individual members by clearing their positions. It also cannot determine whether a member is present with certainty, so a positive lookup does not authorize a safe deletion operation.

A **counting Bloom filter** replaces bits with small counters. Insertion increments each selected counter, deletion decrements it, and lookup requires positive counters. This uses more memory and introduces further requirements:

- Only delete keys known to have been inserted with a matching outstanding count.
- Prevent counter overflow and underflow.
- Define how repeated positions and duplicate insertions are counted.
- Coordinate concurrent increments and decrements safely.

Saturating counters deserve attention: once a counter has lost information by saturating, ordinary decrements may eventually erase evidence for members still present. Counting alone does not solve arbitrary deletion without a sound update policy.

## Growing and Combining Filters

### Scalable Bloom Filters

A fixed filter cannot grow merely by allocating a larger array and copying the old bits. Changing `m` changes probe positions. Without the original keys, those positions cannot be reconstructed.

A **scalable Bloom filter** adds new component filters as capacity is reached. New keys enter the current component; a lookup checks all components. A negative answer requires every component to reject the key.

The error budget must cover the whole structure. If component false-positive probabilities are `p1, p2, ...`, the total is at most their sum by the union bound. Assigning progressively smaller budgets, such as `P/2`, `P/4`, and `P/8`, keeps the infinite sum within an overall budget `P`. The cost is more filters to inspect and generally more memory than one ideally sized static filter.

### Union and Rebuilding

Compatible standard Bloom filters can be united by bitwise OR. Every member of either set remains represented, although the resulting occupancy and false-positive rate increase. Compatibility requires the same bit layout, hashing, seeds, and key encoding.

Bitwise AND has different semantics. It retains the positions needed by true intersection members, but can also retain accidental combinations that do not represent any intersection key. It does not reveal the exact intersection or its membership list. Rebuilding from authoritative keys remains the reliable way to change format, capacity, or representation.

### Publishing a Filter Safely

An immutable filter works naturally beside an immutable SSTable: build both from the same entries and publish their metadata together. A mutable shared dataset needs a more explicit protocol. Publishing a new key in the exact store before the filter contains it creates a window where a filter rejection can hide valid data.

One approach updates the filter before making the key visible, accepting harmless extra positives if the store write later fails. Another publishes a versioned dataset and its matching filter atomically. Concurrent readers, process failures, and replication determine which ordering is actually sufficient.

When rebuilding, keep the previous usable generation until the replacement is complete. A checksum can detect damage, while a version identifier prevents accidentally pairing a filter with the wrong dataset. Neither detects every logical omission during construction. If correctness is uncertain, bypassing the filter preserves exact behavior at the cost of additional work.

## Related Filter Designs

| Design | Main Benefit | Main Cost or Limitation |
|---|---|---|
| **Blocked Bloom filter** | Keeps a key's probes within a small memory region | Uneven block occupancy can worsen error rate at a fixed budget |
| **Counting Bloom filter** | Supports controlled deletion | More memory and counter-management hazards |
| **Cuckoo filter** | Stores fingerprints and supports deletion | Insertions can fail near capacity; deletion needs valid membership knowledge |
| **Xor filter** | Compact static membership with few probes | Normally requires batch construction and rebuilding for changes |

A blocked filter reduces cache-line accesses rather than simply changing the asymptotic operation count. It can be faster despite using more bits for a given error target.

Cuckoo filters place fingerprints into candidate buckets and relocate entries when needed. A positive answer is still approximate. Deleting a key that was never inserted can remove another key's matching fingerprint, so valid deletion discipline remains necessary.

Xor filters construct a system of fingerprint relationships over a known set. Construction may need another hash seed or a retry when a candidate layout fails. Their static nature fits immutable datasets well, but is inconvenient for continuous individual updates. The right comparison includes construction cost, memory access, updates, and the data's lifecycle.

## Real-World Uses

### LSM Trees and Storage Engines

An LSM engine may search several SSTables for one key. A filter can reject a table before its data block is read. **RocksDB** offers configurable filter policies and layouts; **Cassandra** uses Bloom filters to reduce unnecessary SSTable access. Details and defaults depend on the engine and version.

Tombstones must be represented where needed. A filter that excludes deletion markers could incorrectly skip a file whose purpose is to suppress an older value. Filters and the files they summarize should be published as one consistent view.

### Safe Browsing and Network Checks

Chrome historically used a Bloom filter in its Safe Browsing implementation to avoid some unnecessary checks against malicious-address data. This is a historical example, not a description of every current Chrome protection mode. Safe Browsing evolved to use other representations and protocols, and a filter's negative answer can only describe the dataset it summarizes, not prove that a website is safe.

The general pattern is useful whenever a local membership summary can avoid remote work. Privacy, update freshness, and the cost of a false positive must be evaluated alongside latency savings.

### Caching and One-Hit Wonders

A cache can waste space on objects requested only once. A membership filter can record previously seen keys and admit an object only after another request suggests reuse. A first request marks the key; a later possible match permits admission.

False positives admit some first-time objects, and an ever-growing history eventually becomes saturated. Rotating generations, aging schemes, or rebuilding can keep the history useful. This is a cache-admission technique applicable to CDN and application caches, not a claim that every CDN uses one particular filter design.

### Database Joins

For an equality join, a database can build a filter from keys on one side and send it towards the scan of the other side. Rows definitely lacking a matching join key can be discarded before expensive transfer or join processing.

The final join still compares exact keys. Null semantics, encoding, partitioning, and the join type determine whether and where a filter may safely discard rows. In particular, preserving an unmatched side of an outer join requires care. A filter is an execution optimization, not a replacement for SQL semantics.

## When Not to Use a Bloom Filter

- **Exact answers are required without confirmation**: use an exact set or index.
- **Most lookups are positive**: hashing and bit checks may add overhead with little avoided work.
- **The dataset is small**: a simple exact structure may already fit comfortably in memory.
- **Frequent arbitrary deletions dominate**: choose a deletion-capable structure or an exact representation.
- **Keys must be enumerated or values retrieved**: a Bloom filter stores neither.
- **Dataset versions cannot stay synchronized**: stale negatives can violate application correctness.
- **Inputs are adversarial**: unkeyed predictable hashes and unbounded insertion allow deliberate collisions or saturation. Security-sensitive use needs an appropriate threat model.

A cost model helps: the time spent hashing and accessing the filter should be less than the expected authoritative work it eliminates. False-positive rate alone does not establish that result.

## Common Mistakes

Confusing **possibly present** with definitely present is the most direct correctness error. Other frequent mistakes are sizing for API calls rather than distinct keys, ignoring capacity growth, mixing bits and bytes, and using different serialization on different machines.

Concurrency and persistence matter as well. Two non-atomic bit updates to the same machine word can overwrite each other. A damaged or incomplete filter should not silently become an authoritative source of negative answers. An application can fall back to exact checks when a filter is unavailable or incompatible.

Monitor occupancy or estimated error, filter rejection rate, and the expensive operations actually avoided. A filter with a low modeled error rate can still provide little value if almost every request needs the underlying lookup.

## Cheat Sheet

| Concept | Meaning |
|---|---|
| `m` | Total number of bits allocated |
| `n` | Distinct inserted keys, or planned capacity |
| `k` | Probes generated for each key |
| Negative answer | At least one required position is zero |
| Positive answer | All positions are set; exact confirmation may follow |
| Optimal probe estimate | Bits per key multiplied by `ln(2)` |
| Double hashing | Generate probes from a start hash and step hash |
| Standard deletion | Unsafe because members share bits |
| Scalable construction | Add component filters with a combined error budget |
| Safe fallback | Skip the filter and consult the authoritative store |

## Conclusion

A Bloom filter compresses set membership into shared bits and accepts one-sided uncertainty. Insertions set positions, negative lookups find missing evidence, and positive lookups require an exact check when correctness depends on membership.

Sizing determines how quickly shared bits become saturated. Hash generation, serialization, concurrency, and dataset freshness determine whether the implementation preserves the mathematical guarantee. Counting, scalable, blocked, cuckoo, and xor designs change the trade-offs for deletion, growth, locality, or static construction.

The strongest use is as a gate before expensive work: rejecting irrelevant SSTables, avoiding remote checks, shaping cache admission, or pruning join inputs. Its success should be judged by the work avoided while preserving the authoritative system's answers.
