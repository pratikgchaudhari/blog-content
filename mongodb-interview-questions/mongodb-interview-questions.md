---
title: Top 50 MongoDB Interview Questions and Answers
date: 2026-10-19
summary: A comprehensive list of 50 frequently asked MongoDB interview questions with concise answers, covering fundamentals, CRUD, data modeling, indexing, aggregation, replication, sharding, and performance best practices.
tag: Database
draft: false
related: mongodb-indexes-interview-questions
---

### Fundamentals

**1. What is MongoDB?**  
A document-oriented NoSQL database that stores data as BSON documents in collections. It is schema-flexible, horizontally scalable, and built for high write throughput and flexible data models.

**2. What is a document, collection, and database?**  
A document is a BSON object (similar to a JSON object) and the basic unit of data. A collection is a group of documents (analogous to a table, but without a fixed schema). A database is a container of collections.

**3. BSON vs JSON?**  
JSON is a text format. BSON (Binary JSON) is MongoDB’s binary encoding: it adds types such as `ObjectId`, `Date`, `Decimal128`, `Binary`, and `int32`/`int64`, and is more efficient to traverse and store.

**4. What is `_id`?**  
The primary key of every document. If you do not supply one, MongoDB generates an `ObjectId`. It must be unique within the collection and is indexed by default.

**5. What is an ObjectId?**  
A 12-byte identifier: 4 bytes timestamp, 5 bytes random/machine+process, 3 bytes counter. It is roughly ordered by creation time and unique without a central sequence.

**6. How does MongoDB differ from a relational database?**  
No fixed schema, no joins in the classic sense (use embedding or `$lookup`), documents instead of rows, horizontal scaling via sharding is a first-class feature, and transactions exist but are not the default design path.

**7. What is schema flexibility?**  
Documents in the same collection can have different fields. You still design a schema; flexibility means the database does not enforce a rigid table definition. Application-level validation or JSON Schema validation can enforce rules.

**8. What are capped collections?**  
Fixed-size collections that overwrite the oldest documents when full, in insertion order. Useful for logs. They do not support delete of individual documents in the usual way and have restrictions on updates that grow a document.

**9. What is a time-series collection?**  
A specialized collection (MongoDB 5+) optimized for measurements over time. It uses a time field, meta field, and granularity, with internal bucketing for compression and query speed.

**10. What is GridFS?**  
A convention for storing files larger than the 16 MB document limit. It splits files into chunks in `fs.chunks` and metadata in `fs.files`.

### CRUD and queries

**11. Core CRUD methods?**  
`insertOne` / `insertMany`, `find` / `findOne`, `updateOne` / `updateMany` / `replaceOne`, `deleteOne` / `deleteMany`. Bulk writes batch these for efficiency.

**12. `find` vs `findOne`?**  
`find` returns a cursor over matching documents. `findOne` returns a single document or null and stops after the first match.

**13. What is projection?**  
Selecting which fields to return. Example: `db.orders.find({}, { userId: 1, total: 1, _id: 0 })`. Projection reduces network and memory cost.

**14. Common query operators?**  
`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$and`, `$or`, `$nor`, `$not`, `$exists`, `$type`, `$regex`, `$elemMatch`.

**15. What is `$elemMatch`?**  
Matches documents where at least one array element satisfies all the specified conditions. Needed when multiple conditions must apply to the same element.

**16. Update operators?**  
`$set`, `$unset`, `$inc`, `$mul`, `$min`, `$max`, `$rename`, `$push`, `$pull`, `$addToSet`, `$pop`, `$each`, `$slice`, `$currentDate`.

**17. What is an upsert?**  
An update with `upsert: true`. If no document matches, MongoDB inserts one from the query criteria plus the update.

**18. `update` vs `replace`?**  
`update*` with operators modifies fields. `replaceOne` replaces the entire document except `_id`. Replacement documents cannot contain update operators.

**19. What is a cursor?**  
The object returned by `find`. Documents are fetched in batches. You can `sort`, `skip`, `limit`, and `project` on it. Large `skip` values are expensive.

**20. How do you paginate efficiently?**  
Prefer range pagination on an indexed field (`_id` or a created timestamp) over large `skip`. Example: `find({ _id: { $gt: lastId } }).limit(20)`.

### Data modeling

**21. Embedding vs referencing?**  
Embed when data is accessed together, has a bounded size, and is one-to-few (address inside a user). Reference when data is large, shared, frequently updated independently, or one-to-many unbounded (orders for a user).

**22. Why denormalize in MongoDB?**  
To avoid joins and extra round trips. Duplicate data that is read together. Trade-off: writes must keep copies consistent, often in application code or multi-document transactions.

**23. Common schema patterns?**  
Attribute, bucket, computed, extended reference, outlier, subset, approximation, tree (parent references, child references, materialized paths).

**24. Document size limit?**  
16 MB. If you approach it, split the document, use references, or GridFS. Large arrays that grow without bound are a modeling smell.

**25. How do you model one-to-many?**  
Few children: embed. Many or unbounded: store the parent id on the child, or keep an array of child ids only if the list stays small. Subset pattern keeps the latest N embedded and the rest referenced.

### Indexes

**26. Why index?**  
Indexes avoid collection scans. Without a useful index, queries, sorts, and some updates examine every document.

**27. Index types?**  
Single-field, compound, multikey (arrays), text, geospatial (`2dsphere`, `2d`), hashed, TTL, partial, sparse, wildcard, clustered (newer versions).

**28. Compound index order?**  
Equality fields first, then sort fields, then range fields (ESR rule). The order must match how queries filter and sort.

**29. What is a multikey index?**  
An index on an array field. One index entry is created per array element. Compound multikey indexes cannot index more than one array field.

**30. Covered query?**  
A query satisfied entirely from the index, without fetching the document. Project only indexed fields and exclude `_id` if it is not in the index.

**31. TTL index?**  
A single-field index on a date that deletes documents after a specified number of seconds. Deletion is done by a background task, so it is not instantaneous.

**32. Partial vs sparse index?**  
Partial indexes index only documents matching a filter (`partialFilterExpression`). Sparse indexes skip documents missing the indexed field. Partial is more general and preferred for selective indexing.

**33. How do you inspect index use?**  
`explain("executionStats")`. Look for `IXSCAN` vs `COLLSCAN`, keys examined vs documents examined, and whether the sort was in memory.

### Aggregation

**34. What is the aggregation pipeline?**  
A sequence of stages that transform documents. Common stages: `$match`, `$project`, `$group`, `$sort`, `$limit`, `$skip`, `$unwind`, `$lookup`, `$addFields`, `$facet`, `$bucket`.

**35. Why put `$match` and `$sort` early?**  
They can use indexes if placed before stages that reshape documents. Filtering early reduces work for later stages.

**36. `$group`?**  
Groups by an `_id` expression and computes accumulators: `$sum`, `$avg`, `$min`, `$max`, `$first`, `$last`, `$push`, `$addToSet`.

**37. `$lookup`?**  
Left outer join to another collection. Useful for occasional joins; heavy reliance on `$lookup` often means the schema should embed more data.

**38. `$unwind`?**  
Deconstructs an array into one document per element. Often followed by `$group` to reshape. Preserve empty arrays with `preserveNullAndEmptyArrays` if needed.

**39. Aggregation vs MapReduce?**  
Aggregation is faster, uses the pipeline, and is the supported approach. MapReduce is deprecated and should not be used for new work.

**40. What is `$facet`?**  
Runs multiple pipelines on the same input in one pass. Useful for search results plus counts/facets. Each facet output is capped by the 16 MB document limit unless you page inside the facet.

### Replication, sharding, consistency

**41. What is a replica set?**  
A group of `mongod` nodes with one primary and secondaries. The primary receives writes. Secondaries replicate the oplog and can serve reads. Automatic failover elects a new primary.

**42. What is the oplog?**  
A capped collection on the primary recording idempotent write operations. Secondaries apply it to stay in sync. Insufficient oplog window causes secondaries to fall off and require a full resync.

**43. Write concern?**  
How many nodes must acknowledge a write. `w: 1` waits for the primary. `w: "majority"` waits for a majority of voting data-bearing members and is the safe default for durability across failover.

**44. Read preference?**  
Where reads go: `primary`, `primaryPreferred`, `secondary`, `secondaryPreferred`, `nearest`. Secondary reads can be stale. Use primary for read-your-writes unless you accept lag.

**45. What is sharding?**  
Horizontal partitioning of a collection across shards. A `mongos` router sends queries using metadata from config servers. Each shard is typically itself a replica set.

**46. What makes a good shard key?**  
High cardinality, even write distribution, and alignment with common queries. Monotonic keys (plain ObjectId, timestamp) create hot shards. Hashed shard keys spread writes but hurt range queries.

**47. What is a chunk?**  
A contiguous range of shard-key values. The balancer migrates chunks between shards. Jumbo chunks that cannot split become an operational problem.

**48. Transactions in MongoDB?**  
Multi-document ACID transactions exist on replica sets (4.0+) and sharded clusters (4.2+). They have time and size limits. Prefer single-document atomicity and good modeling; use transactions when you must update several documents atomically.

**49. Read concern and causal consistency?**  
Read concern controls what data a read can see (`local`, `majority`, `snapshot`). Causal consistency, with majority write concern and majority/snapshot reads, preserves cause-and-effect across operations in a session.

**50. Performance and production pitfalls?**  
- Missing or wrong indexes causing collection scans.  
- Unbounded arrays and documents near 16 MB.  
- Large `skip` for pagination.  
- Shard key that does not match the query pattern, forcing scatter-gather.  
- Ignoring write concern and reading from stale secondaries when the business needs read-your-writes.  
- No working set in RAM; watch cache pressure, slow queries, and index size.  
- Using transactions for every write instead of embedding data that must change together.  
- Forgetting that `$lookup` and in-memory sorts do not scale like indexed queries.

### Short Java / Spring Data notes (often asked with the above)

- Use `MongoTemplate` for custom queries and aggregation; Spring Data repositories for standard CRUD.  
- Map documents with `@Document`, `@Id`, and `@Indexed` carefully; index definitions in code should match production indexes.  
- Prefer `MongoTransactionManager` only where multi-document atomicity is required.  
- Connection string should include `replicaSet`, `retryWrites=true`, and an appropriate `w` (often `majority`).  
- Convert `ObjectId` explicitly at API boundaries if clients expect strings.
