---
title: How Database Indexes Work and When to Use Each Type
date: 2026-10-25
summary: A detailed guide to database indexes, covering how B-trees, hash, bitmap, GIN, GiST, BRIN, and other index types work under the hood and which queries each one is built for.
tag: databases, indexes, b-tree, query-optimization, performance, PostgreSQL, MySQL, SQL
draft: false
---

An index is a separate data structure that a database keeps alongside a table so it can find rows without reading the whole table. It works much like the index at the back of a book. Instead of flipping through every page looking for "write-ahead logging", you look the term up in the index, which tells you exactly which pages to turn to.

Indexes are the single biggest lever for query performance. A query that scans ten million rows can drop from seconds to under a millisecond with the right index. But indexes are not free: they take disk space, use memory, and slow down every insert, update, and delete. Knowing how they work, and which kind fits which query, is what lets you get the speed without paying more than you need to.

## Why Indexes Matter

Without an index, the only way for a database to answer

```sql
SELECT * FROM users WHERE email = 'pratik@example.com';
```

is a **full table scan**: read every row and check whether the email matches. The cost grows linearly with the size of the table. For 10 rows nobody notices. For 100 million rows it means reading gigabytes of data from disk for a single lookup.

With an index on `email`, the database can jump straight to the matching entry, typically in a handful of page reads, regardless of how big the table is. That's the difference between `O(n)` and `O(log n)` work.

## How Data Is Stored on Disk

To understand indexes you need to know a little about how tables are stored.

Databases store data in fixed-size **pages** (also called blocks), usually 8 KB in PostgreSQL and 16 KB in MySQL InnoDB. A page is the unit of I/O: to read one row, the database reads the whole page containing it into memory, in a cache called the **buffer pool**.

The cost of a query is therefore largely about how many pages it has to touch, and whether those pages are already in memory. An index helps in two ways:

- It reduces the number of pages that have to be read to find matching rows.
- Its pages are small and frequently used, so they tend to stay cached in memory.

## The B-Tree Index

The **B-tree** (strictly, the B+tree variant) is the default index type in almost every relational database: PostgreSQL, MySQL, Oracle, SQL Server, and SQLite all use it when you write a plain `CREATE INDEX`. It suits so many queries that most indexes you'll ever create are B-trees.

### Structure

A B+tree is a balanced tree of pages:

- The **root** and **internal nodes** hold sorted keys and pointers to child pages. They act as signposts.
- The **leaf nodes** hold every key in sorted order, along with a pointer to the row (or, in some designs, the row itself). Leaf pages are linked to their neighbours, so the database can walk through them in order.

```
                         [  M  ]                         <- root
                  /                 \
          [ D   H ]                 [ R   W ]            <- internal nodes
         /   |    \                /    |    \
   [A B C] [D E G] [H K L]  [M N Q] [R S T] [W X Z]      <- leaf nodes
      <->     <->     <->      <->     <->     <->       (linked list)
```

Because each page can hold hundreds of keys, the tree is very wide and very shallow. A B-tree with a fan-out of 500 can index 125 million rows in just three levels:

```
500 x 500 x 500 = 125,000,000
```

So a lookup typically reads three or four pages, and the top levels are almost always cached in memory.

### How a Lookup Works

To find `email = 'pratik@example.com'`:

1. Start at the root page and binary-search its keys to choose the child page that covers the value.
2. Repeat at each internal level.
3. Arrive at a leaf page and find the entry, which gives the row's location.
4. Fetch the row from the table.

### How a Range Scan Works

Because leaves are sorted and linked, B-trees are excellent for ranges:

```sql
SELECT * FROM orders WHERE created_at BETWEEN '2026-10-01' AND '2026-10-31';
```

The database descends the tree once to find the first matching key, then walks along the leaf pages until it passes the end of the range. No backtracking is needed.

### Keeping the Tree Balanced

When a leaf page fills up, it **splits** into two half-full pages and a new key is pushed up into the parent. If the parent fills, it splits too, and occasionally a new root is created. This keeps every leaf at the same depth, so lookups always cost the same. Deletes can leave pages sparsely filled, which is one reason indexes on busy tables slowly bloat and sometimes need rebuilding.

### What B-Trees Are Good For

B-trees support:

- Equality: `WHERE id = 42`
- Ranges: `WHERE price > 100`, `BETWEEN`, `<`, `<=`, `>`, `>=`
- Prefix matches: `WHERE name LIKE 'Prat%'`
- Sorting: `ORDER BY created_at` can read the index in order instead of sorting
- `MIN()` and `MAX()`, which just read the first or last leaf entry
- `IS NULL` checks in most databases

They cannot help with a leading wildcard such as `LIKE '%example.com'`, because the sort order is based on the beginning of the value.

**Use a B-tree when:** you're not sure what to use. It's the right default for primary keys, foreign keys, timestamps, and most columns you filter or sort by.

## Clustered vs Non-Clustered Indexes

Before looking at other index types, it's worth understanding how an index relates to the table itself.

### Clustered Index

In a **clustered index**, the table's rows are physically stored in index order, inside the leaf pages of the index. The index *is* the table. A table can therefore have only one clustered index.

- **MySQL InnoDB** always clusters tables by the primary key. If you don't declare one, InnoDB uses the first unique non-null index, or creates a hidden row ID.
- **SQL Server** lets you choose the clustered index; by default it's the primary key.
- **Oracle** calls these index-organized tables.
- **PostgreSQL** doesn't maintain clustered tables. Its `CLUSTER` command reorders a table once, but new rows aren't kept in order.

**Use case:** Range queries on the clustering key are extremely fast, because matching rows sit next to each other on the same pages. That's why an auto-incrementing or time-ordered primary key works well in InnoDB: new rows are always appended at the end of the tree, and recent data is physically grouped together.

The flip side is that a random primary key, such as a UUIDv4, scatters inserts across the whole tree, causing frequent page splits and poor cache usage. Time-ordered IDs like UUIDv7 or ULIDs avoid this.

### Non-Clustered (Secondary) Index

A **non-clustered index** is a separate structure whose leaf entries point to rows stored elsewhere. You can have many of them.

- In PostgreSQL, every index points to a physical location in the table (a `ctid`).
- In InnoDB, secondary index leaves store the **primary key** value. A lookup through a secondary index finds the primary key, then does a second B-tree lookup in the clustered index to fetch the row. This is why a wide primary key makes every secondary index bigger.

```sql
-- InnoDB: lookup by email walks the email index, then the primary key index
CREATE TABLE users (
    id BIGINT PRIMARY KEY,         -- clustered index
    email VARCHAR(255),
    name VARCHAR(100),
    INDEX idx_users_email (email)  -- secondary index storing (email, id)
);
```

## Unique Indexes

A **unique index** is a B-tree (usually) that also enforces that no two rows have the same key.

```sql
CREATE UNIQUE INDEX idx_users_email ON users (email);
```

Primary keys and `UNIQUE` constraints are implemented with unique indexes behind the scenes.

**Use case:** Enforce business rules such as "one account per email" or "one active subscription per user", while also speeding up lookups on that column. In most databases, multiple `NULL` values are allowed because `NULL` is not considered equal to `NULL`. PostgreSQL 15+ lets you change that with `NULLS NOT DISTINCT`.

## Composite (Multi-Column) Indexes

A **composite index** covers more than one column. The keys are sorted by the first column, then by the second within each value of the first, and so on, like a phone book sorted by last name and then first name.

```sql
CREATE INDEX idx_orders_customer_date ON orders (customer_id, created_at);
```

This index can efficiently answer:

```sql
-- Uses both columns
SELECT * FROM orders WHERE customer_id = 7 AND created_at >= '2026-10-01';

-- Uses the first column only
SELECT * FROM orders WHERE customer_id = 7;

-- Filters on the first column and returns results already sorted by the second
SELECT * FROM orders WHERE customer_id = 7 ORDER BY created_at DESC LIMIT 10;
```

But it generally can't help with:

```sql
-- Skips the first column
SELECT * FROM orders WHERE created_at >= '2026-10-01';
```

This is the **leftmost prefix rule**: a composite index is useful for queries that constrain its columns from left to right. Some databases (Oracle, MySQL 8.0.13+, and PostgreSQL 18) can do a "skip scan" to use later columns when the first column has few distinct values, but you shouldn't design around it.

### Choosing Column Order

A few guidelines:

1. Put columns used with **equality** (`=`, `IN`) before columns used with **ranges** (`>`, `BETWEEN`). Once the index hits a range condition, the columns after it can't narrow the search further.
2. Among equality columns, put those most frequently queried on their own first, so the index serves more queries.
3. Put the column you `ORDER BY` after the equality columns, so the results come out of the index already sorted.

**Use case:** Queries that always filter on the same combination of columns, such as "orders for this customer in this date range" or "messages in this conversation, newest first".

## Covering Indexes and Index-Only Scans

When an index contains every column a query needs, the database can answer the query from the index alone, without visiting the table. This is called an **index-only scan** (or a covering index).

```sql
-- PostgreSQL and SQL Server: store extra columns in the leaf pages only
CREATE INDEX idx_orders_customer_covering
    ON orders (customer_id, created_at)
    INCLUDE (total_amount, status);

-- This query never touches the orders table
SELECT created_at, total_amount, status
FROM orders
WHERE customer_id = 7
ORDER BY created_at DESC;
```

In MySQL, you get the same effect by adding the columns to the index key, and InnoDB secondary indexes always include the primary key for free.

**Use case:** Hot queries on large tables where avoiding the extra table lookup per row makes a real difference, such as dashboards or APIs that list a user's recent items. In PostgreSQL, index-only scans also depend on the visibility map being up to date, so tables need regular `VACUUM`.

## Partial (Filtered) Indexes

A **partial index** only includes rows that match a condition.

```sql
-- PostgreSQL: only index orders that still need processing
CREATE INDEX idx_orders_pending ON orders (created_at)
    WHERE status = 'pending';

-- SQL Server calls these filtered indexes
CREATE INDEX idx_orders_pending ON orders (created_at)
    WHERE status = 'pending';
```

If only 1% of orders are pending, the index is a hundred times smaller than a full one, cheaper to maintain, and more likely to stay in memory. A query can use it only when its `WHERE` clause implies the index's condition.

Partial indexes can also enforce conditional uniqueness:

```sql
-- Each user may have only one active subscription
CREATE UNIQUE INDEX idx_one_active_subscription
    ON subscriptions (user_id)
    WHERE status = 'active';
```

**Use case:** Queries that target a small, well-defined subset of rows, such as unprocessed jobs, non-deleted records (`WHERE deleted_at IS NULL`), or flagged items.

## Expression (Functional) Indexes

An **expression index** indexes the result of a function or expression instead of a raw column.

```sql
-- Case-insensitive email lookups
CREATE INDEX idx_users_lower_email ON users (lower(email));

SELECT * FROM users WHERE lower(email) = 'pratik@example.com';

-- Index on a value inside a JSON document
CREATE INDEX idx_events_type ON events ((payload->>'type'));

-- MySQL 8.0.13+ uses double parentheses for functional key parts
CREATE INDEX idx_users_lower_email ON users ((lower(email)));
```

A normal index on `email` can't help with `WHERE lower(email) = ...`, because the database would have to compute `lower()` for every row. The query must use the exact same expression as the index.

**Use case:** Case-insensitive searches, filtering on dates extracted from timestamps, or querying a specific field inside JSON.

## Hash Indexes

A **hash index** applies a hash function to each key and stores the result in buckets. A lookup hashes the search value and goes straight to the right bucket.

```sql
-- PostgreSQL
CREATE INDEX idx_sessions_token ON sessions USING hash (token);
```

Hash indexes support **only equality** comparisons. They can't do ranges, sorting, or prefix matches, because hashing scrambles the order of keys. In practice a B-tree is almost as fast for equality and far more flexible, so hash indexes are a niche choice.

Some notes by database:

- PostgreSQL hash indexes have been crash-safe and replicated only since version 10, so older advice warns against them.
- MySQL's MEMORY engine supports hash indexes. InnoDB doesn't let you create them directly, but builds an internal **adaptive hash index** automatically on top of hot B-tree pages.

**Use case:** Equality lookups on long values, such as session tokens or URLs, where a hash index can be smaller than a B-tree because it stores a fixed-size hash rather than the full key.

## Bitmap Indexes

A **bitmap index** stores, for each distinct value in a column, a bit array with one bit per row. A bit is set to 1 if that row has that value.

```
Row:              1  2  3  4  5  6  7  8
status='active'   1  0  1  1  0  0  1  0
status='inactive' 0  1  0  0  1  0  0  0
status='banned'   0  0  0  0  0  1  0  1
```

Combining conditions becomes a fast bitwise operation. `WHERE status = 'active' AND region = 'EU'` is just a bitwise `AND` of two bitmaps. Bitmaps also compress extremely well when there are few distinct values.

```sql
-- Oracle
CREATE BITMAP INDEX idx_customers_status ON customers (status);
```

The downside is updates. Changing one row can require locking and rewriting a large compressed bitmap segment, which makes bitmap indexes a poor fit for busy transactional tables.

- **Oracle** supports persistent bitmap indexes.
- **PostgreSQL** doesn't have them, but builds bitmaps on the fly during a **Bitmap Index Scan**, which lets it combine several ordinary B-tree indexes in one query.
- Columnar and analytics databases use bitmap-like structures extensively.

**Use case:** Data warehouses and reporting tables with columns that have relatively few distinct values (status, region, category, gender), where queries combine many filters and data is loaded in bulk rather than updated row by row.

## Full-Text Indexes

A plain index can't efficiently answer "find documents containing the word *replication*", because the word could appear anywhere in the text. A **full-text index** solves this with an **inverted index**: a map from each word (after normalisation, such as lowercasing and stemming) to the list of documents that contain it.

```
"replic"   -> [doc 3, doc 17, doc 42]
"databas"  -> [doc 1, doc 3, doc 8, doc 42]
"index"    -> [doc 8, doc 42]
```

```sql
-- MySQL
CREATE FULLTEXT INDEX idx_articles_body ON articles (title, body);

SELECT * FROM articles
WHERE MATCH(title, body) AGAINST ('database replication' IN NATURAL LANGUAGE MODE);

-- PostgreSQL: a GIN index over a tsvector
CREATE INDEX idx_articles_search
    ON articles USING gin (to_tsvector('english', title || ' ' || body));

SELECT * FROM articles
WHERE to_tsvector('english', title || ' ' || body)
      @@ to_tsquery('english', 'database & replication');
```

**Use case:** Searching words and phrases in articles, product descriptions, support tickets, or comments, with relevance ranking. For large-scale or very feature-rich search, a dedicated engine such as Elasticsearch or OpenSearch is often used alongside the database.

## GIN Indexes (Generalized Inverted Index)

**GIN** is PostgreSQL's general-purpose inverted index. It's built for values that contain many elements, and indexes each element separately so you can ask "which rows contain this element?"

```sql
-- JSONB documents
CREATE INDEX idx_products_attributes ON products USING gin (attributes);

SELECT * FROM products WHERE attributes @> '{"color": "red", "size": "M"}';

-- Arrays
CREATE INDEX idx_posts_tags ON posts USING gin (tags);

SELECT * FROM posts WHERE tags @> ARRAY['postgres', 'performance'];

-- Fast LIKE '%...%' searches using trigrams (requires the pg_trgm extension)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_users_name_trgm ON users USING gin (name gin_trgm_ops);

SELECT * FROM users WHERE name ILIKE '%chaud%';
```

GIN lookups are fast, but the index is relatively expensive to update, since one row can produce many index entries. PostgreSQL softens this with a "pending list" that batches new entries (`fastupdate`).

**Use case:** JSONB containment queries, array membership, full-text search, and substring or fuzzy text search with trigrams.

## GiST and SP-GiST Indexes

**GiST** (Generalized Search Tree) is a framework in PostgreSQL for building balanced tree indexes over data that doesn't have a simple linear order, such as shapes, ranges, and points. Instead of storing sorted keys, internal nodes store a summary that covers everything beneath them, for example a bounding box that contains all the shapes in a subtree.

```sql
-- Geospatial data with PostGIS: find stores within 5 km
CREATE INDEX idx_stores_location ON stores USING gist (location);

SELECT name FROM stores
WHERE ST_DWithin(location, ST_MakePoint(73.8567, 18.5204)::geography, 5000);

-- Nearest neighbours, ordered by distance
SELECT name FROM stores
ORDER BY location <-> ST_MakePoint(73.8567, 18.5204)::geography
LIMIT 5;

-- Prevent overlapping room bookings with an exclusion constraint
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE bookings (
    room_id INT,
    during TSTZRANGE,
    EXCLUDE USING gist (room_id WITH =, during WITH &&)
);
```

**SP-GiST** (space-partitioned GiST) supports structures that divide space into non-overlapping regions, such as quadtrees, k-d trees, and radix tries. It works well for points that are unevenly distributed and for text prefixes, such as IP addresses or phone numbers.

**Use case:** Geospatial queries (distance, containment, nearest neighbour), range types and overlap checks such as scheduling conflicts, and similarity search.

## Spatial R-Tree Indexes

Outside PostgreSQL, spatial data is usually indexed with an **R-tree**, which groups nearby objects into nested bounding rectangles. A query like "what's inside this map area?" only descends into rectangles that overlap the search area.

```sql
-- MySQL
CREATE TABLE places (
    id INT PRIMARY KEY,
    name VARCHAR(100),
    location POINT NOT NULL SRID 4326,
    SPATIAL INDEX idx_places_location (location)
);

SELECT name FROM places
WHERE MBRContains(
    ST_GeomFromText('POLYGON((18.4 73.7, 18.4 74.0, 18.7 74.0, 18.7 73.7, 18.4 73.7))', 4326),
    location
);
```

**Use case:** Maps, delivery zones, ride-hailing, store locators, and any query based on location or geometry.

## BRIN Indexes (Block Range Index)

A **BRIN** index in PostgreSQL doesn't index individual rows at all. It divides the table into ranges of consecutive pages (128 by default) and stores only a summary for each range, typically the minimum and maximum value.

```
Pages 0-127     created_at: 2026-01-01 .. 2026-01-09
Pages 128-255   created_at: 2026-01-09 .. 2026-01-17
Pages 256-383   created_at: 2026-01-17 .. 2026-01-25
...
```

For a query on `created_at`, the database skips every range whose min/max can't contain matching values and scans only the rest.

```sql
CREATE INDEX idx_events_created_brin ON events USING brin (created_at);
```

A BRIN index on a billion-row table can be a few megabytes, compared with tens of gigabytes for a B-tree. The catch is that it only works well when the column's values are **correlated with physical row order**. If rows with every timestamp are scattered across the table, every range's min/max covers almost everything and the index can't skip much.

**Use case:** Huge, append-only tables where the indexed column naturally increases over time, such as logs, sensor readings, event streams, and audit trails.

## Vector Indexes

With the rise of AI applications, databases increasingly store **embeddings**: arrays of hundreds or thousands of numbers that represent the meaning of text, images, or audio. Finding the most similar items means finding the nearest vectors, which ordinary indexes can't do efficiently in high dimensions.

Vector indexes use **approximate nearest neighbour (ANN)** algorithms, trading a little accuracy for a huge speed-up:

- **HNSW** (Hierarchical Navigable Small World) builds a layered graph where each vector links to its neighbours. Searches hop through the graph towards the query. It's fast and accurate but uses a lot of memory.
- **IVFFlat** (Inverted File) clusters vectors and searches only the clusters closest to the query. It builds faster and uses less memory, but recall depends on how many clusters you probe.

```sql
-- PostgreSQL with the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
    id BIGSERIAL PRIMARY KEY,
    content TEXT,
    embedding VECTOR(1536)
);

CREATE INDEX idx_documents_embedding
    ON documents USING hnsw (embedding vector_cosine_ops);

SELECT id, content
FROM documents
ORDER BY embedding <=> '[0.012, -0.034, ...]'::vector
LIMIT 5;
```

**Use case:** Semantic search, retrieval-augmented generation (RAG), recommendations, and image or audio similarity.

## LSM-Tree Based Indexes

Not every database uses B-trees for storage. Cassandra, RocksDB, ScyllaDB, LevelDB, and the storage engines under CockroachDB and TiDB use **Log-Structured Merge trees (LSM trees)**.

An LSM tree buffers writes in memory (a **memtable**), flushes them to disk as immutable, sorted files (**SSTables**), and merges those files in the background through **compaction**. Each SSTable often has a **Bloom filter**, a compact probabilistic structure that can say "this key is definitely not here", so reads can skip files quickly.

**Use case:** Write-heavy workloads such as time series, messaging, metrics, and event ingestion, where turning random writes into sequential ones matters more than the slightly higher cost of reads.

## Choosing the Right Index

| Index type | Best for | Typical example |
| --- | --- | --- |
| B-tree | Equality, ranges, sorting, prefix search | `WHERE created_at > ?`, `ORDER BY` |
| Clustered | Range scans on the main access key | InnoDB primary key, time-ordered IDs |
| Unique | Enforcing no duplicates | Email, username |
| Composite | Filters on several columns together | `(customer_id, created_at)` |
| Covering | Avoiding table lookups on hot queries | `INCLUDE (status, total)` |
| Partial | Small, frequently queried subsets | `WHERE status = 'pending'` |
| Expression | Queries on computed values | `lower(email)`, JSON fields |
| Hash | Equality on long keys | Session tokens |
| Bitmap | Low-distinct-value columns in analytics | Status, region in a warehouse |
| Full-text | Word and phrase search | Article and product search |
| GIN | JSONB, arrays, trigram search | `attributes @> '{"color":"red"}'` |
| GiST / SP-GiST / R-tree | Geometry, ranges, nearest neighbour | Store locator, booking overlaps |
| BRIN | Huge, naturally ordered tables | Logs and events by time |
| Vector (HNSW, IVFFlat) | Similarity search on embeddings | Semantic search, RAG |

## The Cost of Indexes

Every index speeds up some reads and slows down every write. Before adding one, weigh:

- **Write amplification.** Each `INSERT` must add an entry to every index on the table. Each `UPDATE` of an indexed column, and in some databases any update at all, has to modify index entries too.
- **Storage.** Indexes on large tables can be bigger than the table itself.
- **Memory pressure.** Indexes compete with table data for space in the buffer pool. An index that doesn't fit in memory loses much of its benefit.
- **Maintenance.** Indexes fragment and bloat over time and may need rebuilding (`REINDEX` in PostgreSQL, `OPTIMIZE TABLE` or `ALTER TABLE ... FORCE` in MySQL).
- **Planner complexity.** More indexes give the query planner more choices, and occasionally it picks a worse one.

## When the Database Ignores Your Index

Having an index doesn't guarantee it will be used. Common reasons include:

- **Low selectivity.** If a query matches a large share of the table, say 30% of rows, a sequential scan is often cheaper than jumping back and forth through an index.
- **Functions on the column.** `WHERE YEAR(created_at) = 2026` can't use an index on `created_at`. Rewrite it as a range: `WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01'`.
- **Implicit type conversion.** Comparing a `VARCHAR` column to a number, for example `WHERE phone = 9876543210`, can force a conversion on every row.
- **Leading wildcards.** `LIKE '%gmail.com'` can't use a B-tree. Use a trigram index, or store a reversed copy of the value.
- **Wrong column order** in a composite index for the query's filters.
- **`OR` across different columns**, which may require a bitmap combination of two indexes or a `UNION` rewrite.
- **Stale statistics.** The planner estimates row counts from statistics. Run `ANALYZE` (PostgreSQL) or `ANALYZE TABLE` (MySQL) after large data changes.

## Seeing Indexes in Action with EXPLAIN

`EXPLAIN` shows the plan the database chose, and `EXPLAIN ANALYZE` actually runs the query and reports real timings.

```sql
EXPLAIN ANALYZE
SELECT * FROM orders WHERE customer_id = 7 ORDER BY created_at DESC LIMIT 10;
```

Before adding an index you might see:

```
Limit  (actual time=812.4..812.4 rows=10 loops=1)
  ->  Sort  (actual time=812.4..812.4 rows=10 loops=1)
        Sort Key: created_at DESC
        ->  Seq Scan on orders  (actual time=0.03..809.1 rows=1204 loops=1)
              Filter: (customer_id = 7)
              Rows Removed by Filter: 4998796
Execution Time: 812.5 ms
```

After `CREATE INDEX idx_orders_customer_date ON orders (customer_id, created_at);`:

```
Limit  (actual time=0.04..0.07 rows=10 loops=1)
  ->  Index Scan Backward using idx_orders_customer_date on orders
        (actual time=0.04..0.06 rows=10 loops=1)
        Index Cond: (customer_id = 7)
Execution Time: 0.09 ms
```

The sequential scan and the sort have both disappeared. The database walks the index backwards for customer 7 and stops after ten rows.

The plan node names to look out for are:

- **Seq Scan / Full Table Scan**: the whole table was read.
- **Index Scan**: the index was used to find rows, then the table was visited.
- **Index Only Scan**: the query was answered from the index alone.
- **Bitmap Index Scan / Bitmap Heap Scan**: matching locations were gathered from one or more indexes first, then the table pages were read in physical order.

## Practical Tips

- **Index for your queries, not your columns.** Start from the slowest and most frequent queries (`pg_stat_statements` in PostgreSQL, the slow query log in MySQL) and design indexes that serve them.
- **Index foreign keys.** Joins and cascading deletes on a foreign key without an index can trigger full scans of the child table.
- **Prefer one good composite index over several single-column ones** for queries that always filter together.
- **Remove unused and duplicate indexes.** An index on `(a)` is redundant if you also have one on `(a, b)`. PostgreSQL's `pg_stat_user_indexes.idx_scan` and MySQL's `sys.schema_unused_indexes` show which indexes are never used.
- **Build indexes without blocking writes in production.** Use `CREATE INDEX CONCURRENTLY` in PostgreSQL, or online DDL (`ALGORITHM=INPLACE, LOCK=NONE`) in MySQL.
- **Keep statistics fresh and watch for bloat**, especially on tables with heavy update or delete traffic.
- **Measure before and after** with `EXPLAIN ANALYZE`, and test with production-sized data. A plan on a 1,000-row development table tells you very little about a 100-million-row production table.

## Conclusion

An index trades extra storage and slower writes for much faster reads by organising data so the database can go straight to what it needs. The B-tree handles the vast majority of cases: equality, ranges, sorting, and prefix searches. Composite, covering, partial, and expression indexes let you shape a B-tree precisely around your queries. When the data or the question doesn't fit a sorted order, specialised indexes take over: hash for pure equality, bitmap for analytics, GIN and full-text for searching inside values, GiST and R-trees for geometry and ranges, BRIN for enormous ordered tables, and vector indexes for similarity search.

The skill isn't knowing every index type by heart. It's looking at a slow query, understanding how the database will have to find its rows, and choosing the smallest index that turns a full scan into a short walk.
