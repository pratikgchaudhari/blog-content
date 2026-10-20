---
title: Top 100 MongoDB Indexes Interview Questions with Crisp Answers
date: 2026-10-20
summary: A comprehensive collection of the top 100 MongoDB indexes interview questions with short, practical answers.
tag: [mongodb, indexes, interview, database, nosql]
draft: false
---

# Top 100 MongoDB Indexes Interview Questions

## Basics of Indexes

1. **What is an index in MongoDB?**  
   A data structure that improves query performance by allowing fast lookups instead of full collection scans (COLLSCAN).

2. **What is the default index in MongoDB?**  
   Every collection has a unique index on the `_id` field that cannot be dropped.

3. **How do indexes improve performance?**  
   They reduce the number of documents examined and disk I/O by storing sorted keys and pointers to documents.

4. **What is the cost of indexes?**  
   Extra storage and write overhead — every insert/update/delete must update all relevant indexes.

5. **How do you create an index?**  
   `db.collection.createIndex({ field: 1 })` (1 = ascending, -1 = descending).

6. **How do you list all indexes on a collection?**  
   `db.collection.getIndexes()` or `db.collection.getIndexes().length` for the count.

7. **How do you drop an index?**  
   `db.collection.dropIndex("indexName")` or `db.collection.dropIndex({ field: 1 })`.

8. **Can you drop the `_id` index?**  
   No. The `_id` index is mandatory and cannot be dropped.

9. **What data structure does MongoDB use for indexes?**  
   B-tree (implemented by WiredTiger).

10. **What is index selectivity?**  
    The ratio of distinct values to total documents. High selectivity (more unique values) makes indexes more effective.

11. **What happens if no index exists for a query?**  
    MongoDB performs a full collection scan (COLLSCAN).

12. **What is a covered query?**  
    A query that can be satisfied entirely from the index without fetching full documents (IXSCAN + no FETCH stage).

13. **How do you check if a query uses an index?**  
    Use `.explain("executionStats")` and look for `IXSCAN` (good) vs `COLLSCAN` (bad).

14. **What does `totalDocsExamined` tell you?**  
    Number of documents examined. Ideally close to `nReturned` for efficient queries.

15. **What is the working set?**  
    The portion of data and indexes that must fit in RAM for optimal performance.

## Index Types

16. **What is a single-field index?**  
    An index on one field. Direction (1 or -1) does not matter for single-field indexes because MongoDB can traverse in either direction.

17. **What is a compound index?**  
    An index on multiple fields. Field order is critical.

18. **What is a multikey index?**  
    An index automatically created when indexing an array field. One index entry is created per array element.

19. **What is a text index?**  
    Supports full-text search on string content using `$text` operator. One text index per collection.

20. **What is a geospatial index?**  
    Supports location-based queries. `2dsphere` for spherical (Earth) data, `2d` for planar data.

21. **What is a hashed index?**  
    Indexes the hash of a field’s value. Useful for equality queries and shard key distribution. Does not support range queries.

22. **What is a wildcard index?**  
    Indexes all fields or all fields matching a pattern (`$**`). Useful for flexible/schemaless documents.

23. **Can a compound index contain a hashed field?**  
    No. Hashed indexes cannot be part of a compound index.

24. **How many fields can a compound index have?**  
    Up to 32 fields.

25. **What is the maximum size of an index key?**  
    1024 bytes.

26. **What is a unique index?**  
    Enforces uniqueness on the indexed field(s). Duplicate values cause `E11000` duplicate key error.

27. **What is a sparse index?**  
    Only indexes documents that contain the indexed field (skips missing/null fields). Legacy option; prefer partial indexes.

28. **What is a partial index?**  
    Indexes only documents that match a filter expression (`partialFilterExpression`). More flexible than sparse.

29. **What is a TTL index?**  
    Automatically expires documents after a specified time (`expireAfterSeconds`). Only works on date fields.

30. **What is a hidden index?**  
    An index that is maintained but not used by the query planner. Useful for testing index removal safely.

31. **What is a collation index?**  
    Supports language-specific string comparison rules (case-insensitive, accent-insensitive, etc.).

32. **Can you create an index on an embedded document field?**  
    Yes, using dot notation: `{ "address.city": 1 }`.

33. **Can you index the entire embedded document?**  
    Yes, but queries must match the exact document structure (order and fields).

34. **What is a case-insensitive index?**  
    Created using a collation with `strength: 2` (or similar).

35. **How many text indexes can a collection have?**  
    Only one text index per collection.

36. **What operators does a text index support?**  
    Primarily `$text` and `$meta` for text score.

37. **What is a 2dsphere index used for?**  
    Geospatial queries on spherical Earth data (GeoJSON points, lines, polygons).

38. **What is a 2d index used for?**  
    Legacy geospatial index for planar (flat) coordinate data.

39. **Can multikey indexes be compound?**  
    Yes, but a compound multikey index can contain **at most one** array field.

40. **Do multikey indexes support covered queries?**  
    Only if the query projects only the indexed fields and the array field is not projected as an array.

## Compound Indexes & Query Patterns

41. **What is the index prefix rule?**  
    A compound index on `{A:1, B:1, C:1}` can be used for queries on `A`, `A+B`, or `A+B+C`. It cannot be used for `B` or `C` alone.

42. **What is the ESR rule?**  
    Equality → Sort → Range. Optimal field order for compound indexes: equality fields first, then sort fields, then range fields.

43. **Why does field order matter in compound indexes?**  
    MongoDB uses the index from left to right. After a range condition, remaining fields cannot be used efficiently for sorting.

44. **Can a compound index support sorting?**  
    Yes, if the sort direction matches the index direction (or the reverse of the entire index).

45. **What happens if sort direction does not match the index?**  
    MongoDB may perform an in-memory sort (SORT stage), which can be expensive or hit the 32 MB limit.

46. **Can you have multiple compound indexes that share prefixes?**  
    Yes, but it is often redundant. Prefer one well-designed compound index.

47. **How do you index for a query with equality and range?**  
    Put equality fields first, then the range field.

48. **How do you index for a query that filters and sorts?**  
    Follow ESR: equality fields → sort field → range fields.

49. **What is index intersection?**  
    MongoDB can use multiple indexes for a single query (usually less efficient than a single compound index).

50. **When is index intersection useful?**  
    Rarely preferred. A well-designed compound index is almost always better.

51. **Can compound indexes be used for queries on trailing fields?**  
    No. Only prefixes of the index can be used.

52. **What is the difference between `{a:1, b:1}` and `{b:1, a:1}`?**  
    They support different query patterns. The first supports queries starting with `a`; the second supports queries starting with `b`.

53. **How many compound indexes should you create?**  
    As few as possible. Each index adds write overhead. Design for your most common query patterns.

54. **Can you use a compound index for a single-field query?**  
    Yes, if the single field is the prefix of the compound index.

55. **What is the recommended way to name indexes?**  
    Use explicit names: `createIndex(..., { name: "status_date_idx" })` for easier management.

## Multikey, Text, Geospatial & Special Indexes

56. **When is a multikey index created?**  
    Automatically when you index a field that contains an array in any document.

57. **Can you create a multikey index on multiple array fields in one compound index?**  
    No. A compound multikey index can include at most one array field.

58. **How do multikey indexes affect query performance?**  
    They can increase index size significantly if arrays are large.

59. **What is the difference between indexing an array field and indexing array elements?**  
    Indexing the array field creates a multikey index with one entry per element.

60. **Can text indexes be combined with other index types?**  
    Limited. Text indexes have restrictions when combined with other fields.

61. **What language does a text index use by default?**  
    English. You can specify `default_language` or per-document language.

62. **How do you create a text index on multiple fields?**  
    `createIndex({ title: "text", content: "text" })`.

63. **What is the text score?**  
    A relevance score returned by `$meta: "textScore"` for ranking text search results.

64. **Can you create a geospatial index on a non-GeoJSON field?**  
    Yes for `2d` (legacy), but `2dsphere` requires GeoJSON.

65. **What is the difference between `$near` and `$geoWithin`?**  
    `$near` returns results sorted by distance; `$geoWithin` returns documents within a shape (no sorting).

66. **What is a hashed index primarily used for?**  
    Even distribution of data across shards when used as a shard key. Also supports equality queries.

67. **Does a hashed index support range queries?**  
    No.

68. **What is a wildcard index useful for?**  
    Collections with dynamic or unpredictable field names (schemaless data).

69. **How do you create a wildcard index on all fields?**  
    `createIndex({ "$**": 1 })`.

70. **How do you create a wildcard index on specific fields?**  
    `createIndex({ "attr.$**": 1 })`.

71. **Can wildcard indexes be sparse?**  
    Yes, they can use `sparse: true` or partial filter expressions.

72. **What is the difference between sparse and partial indexes?**  
    Sparse skips missing fields. Partial indexes only documents matching a custom filter expression.

73. **When should you use a partial index?**  
    When only a subset of documents needs to be indexed (e.g., only active users).

74. **Can a partial index be unique?**  
    Yes. Uniqueness is enforced only on documents that match the partial filter.

75. **How often does the TTL monitor run?**  
    Approximately every 60 seconds. Expiry is not exact.

## Index Options & Constraints

76. **What happens when you insert a duplicate into a unique index?**  
    The operation fails with error code `11000` (duplicate key error).

77. **Can unique indexes contain null values?**  
    Yes, but only one document can have a missing/null value for a sparse unique index. Non-sparse unique indexes treat null as a value.

78. **What is the difference between `sparse: true` and `partialFilterExpression`?**  
    Sparse is a special case of partial. Partial is more powerful and recommended.

79. **Can you create a TTL index on a non-date field?**  
    No. TTL indexes require a date field (or an array of dates).

80. **Can you have multiple TTL indexes on a collection?**  
    Yes, but each document can only be expired by one TTL index.

81. **What is a background index build?**  
    Older versions built indexes in the background. Modern MongoDB builds indexes in a way that minimizes locking.

82. **What is the difference between foreground and background index builds?**  
    Foreground builds lock the database. Background builds allow reads/writes but take longer. (Mostly historical in recent versions.)

83. **How do you create a unique sparse index?**  
    `createIndex({ email: 1 }, { unique: true, sparse: true })`.

84. **What is collation strength?**  
    Determines comparison sensitivity. Strength 1 = base characters only, Strength 2 = case-insensitive, Strength 3 = case-sensitive.

85. **Can you change an existing index’s options?**  
    No. You must drop and recreate the index.

## Query Optimization & Explain

86. **What stages in explain() indicate a good index usage?**  
    `IXSCAN` followed by limited `FETCH` (or no FETCH for covered queries). Avoid `COLLSCAN` and large `SORT`.

87. **What is a blocking sort?**  
    An in-memory sort that occurs when the index cannot provide the required order. Limited to 32 MB by default.

88. **How do you force a particular index?**  
    Use `.hint("indexName")` or `.hint({ field: 1 })`.

89. **What does `executionStats.nReturned` mean?**  
    Number of documents returned by the query.

90. **What does `executionStats.totalKeysExamined` mean?**  
    Number of index keys examined.

91. **What is a covered query advantage?**  
    No document fetch is needed, resulting in the fastest possible query performance.

92. **How can you make a query covered?**  
    Project only fields that exist in the index (including `_id` if needed, or exclude `_id`).

93. **What is the impact of `$where` on indexes?**  
    `$where` generally cannot use indexes efficiently and forces a collection scan.

94. **Can regular expressions use indexes?**  
    Only prefix (anchored) regexes can use indexes. Unanchored regexes (`/abc/`) cannot.

95. **What is the best way to monitor index usage?**  
    Use `$indexStats` aggregation stage or `db.collection.aggregate([{ $indexStats: {} }])`.

## Best Practices & Advanced Topics

96. **What is the biggest risk of having too many indexes?**  
    Write amplification — every write must update all indexes, increasing latency and storage.

97. **Should you index every field you query?**  
    No. Index only fields used in high-frequency, selective queries. Prefer compound indexes.

98. **What is the recommended order for compound index fields?**  
    Follow ESR: Equality fields first, Sort field next, Range fields last.

99. **How do you safely remove an index in production?**  
    First hide the index (`hideIndex`), monitor performance, then drop it if safe.

100. **What should you check before creating a new index?**  
    Query patterns (via profiler or logs), existing indexes, cardinality/selectivity, and write impact. Always validate with `explain()`.
