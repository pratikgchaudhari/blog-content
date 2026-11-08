---
title: The N+1 Problem in JPA and Hibernate - Causes, Detection, Fetch Joins, Entity Graphs and Batch Fetching
date: 2026-11-08
summary: A detailed guide to the N+1 query problem covering lazy and eager fetching, SQL detection, fetch joins, entity graphs, batch and subselect fetching, DTO projections, pagination, and Spring Data JPA.
tag: jpa, hibernate, spring-data-jpa, sql, databases, performance, fetching, java
draft: false
related: top-10-questions-of-query-annotation-in-spring-jpa,database-internals,how-database-indexes-work,latency-percentiles-explained
---

The **N+1 query problem** occurs when an application retrieves a group of records with one query and then issues additional queries while accessing related data for each record. A request that appears to load one list can therefore generate a number of database round trips proportional to the list's size.

This pattern predates JPA and is not unique to object-relational mapping. A JDBC loop that queries children for each parent has the same behavior. Hibernate, which began in 2001, made navigating persistent object graphs convenient; the Java Persistence API standardized a portable persistence model in 2006 and later moved under Jakarta Persistence. Proxies, collection wrappers, and automatic association loading preserve that convenience, but can conceal where database access happens.

The solution is to design a **fetch plan** for each use case. Mapping annotations describe association defaults; a fetch plan describes which data a particular operation needs and how to retrieve it. This article uses Jakarta Persistence, Hibernate 6, and Spring Data JPA to explain the difference and the available solutions.

## An Author and Book Model

Consider authors with a one-to-many collection of books. Each book refers to one author. The classes below use field access, explicitly named tables, and lazy associations. Place the public classes in separate files; imports and routine write methods are omitted where they do not affect fetching.

```java
import jakarta.persistence.*;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "authors")
public class Author {
    @Id
    private Long id;

    private String name;

    @OneToMany(mappedBy = "author", fetch = FetchType.LAZY)
    private List<Book> books = new ArrayList<>();

    protected Author() {}

    public Long getId() { return id; }
    public String getName() { return name; }
    public List<Book> getBooks() { return books; }
}
```

```java
import jakarta.persistence.*;

@Entity
@Table(name = "books")
public class Book {
    @Id
    private Long id;

    private String title;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "author_id", nullable = false)
    private Author author;

    protected Book() {}

    public Long getId() { return id; }
    public String getTitle() { return title; }
    public Author getAuthor() { return author; }
}
```

The application loads authors and renders their books inside an active persistence context:

```java
List<Author> authors = entityManager.createQuery(
        "select a from Author a order by a.id", Author.class)
    .getResultList();

for (Author author : authors) {
    for (Book book : author.getBooks()) {
        System.out.println(author.getName() + ": " + book.getTitle());
    }
}
```

With cold caches, no batch fetching, and ordinary collection initialization, the SQL has this shape:

```sql
select a.id, a.name from authors a order by a.id;

select b.id, b.title, b.author_id from books b where b.author_id = ?;
select b.id, b.title, b.author_id from books b where b.author_id = ?;
select b.id, b.title, b.author_id from books b where b.author_id = ?;
-- One collection query for each author's collection that is initialized.
```

The SQL is schematic: aliases, selected columns, placeholders, and ordering depend on the dialect and mapping. For three authors, initializing all three collections produces one root query plus three collection queries, or four statements. For `N` authors, that pattern is `1 + N`.

```
Load author list ---------> Query 1
    |
    +-> author 1 books ---> Query 2
    +-> author 2 books ---> Query 3
    +-> author 3 books ---> Query 4
    +-> ...
```

Even an author with no books may require a query to establish that its collection is empty. The problem is the repeated lookup pattern, not merely the amount of child data.

## Why It Happens

### Lazy and Eager Defaults

Jakarta Persistence association defaults are:

| Association | Default Fetch Type |
|---|---|
| `@ManyToOne` | `EAGER` |
| `@OneToOne` | `EAGER` |
| `@OneToMany` | `LAZY` |
| `@ManyToMany` | `LAZY` |

**EAGER** requires associated state to be fetched eagerly, but does not mandate one SQL join. **LAZY** permits deferred loading and is a hint in the specification. Hibernate's ability to defer a particular association depends on the mapping, proxies, and bytecode enhancement. Inverse one-to-one associations are a notable case where determining whether an association exists can itself require work.

A lazy collection is initially a wrapper representing unloaded state. Traversal initializes it. A lazy to-one reference can be represented by a proxy or enhanced entity. Ordinary property access can resolve that reference through another query.

### Eager Associations Can Still Produce N+1

Suppose `Book.author` uses the default eager fetch type. The query below still does not explicitly fetch the author with a join:

```java
List<Book> books = entityManager.createQuery(
        "select b from Book b order by b.id", Book.class)
    .getResultList();
```

Hibernate can select books first and then issue secondary selects to satisfy eager author loading. The association is initialized before the result is returned, but the database still receives multiple statements. The [Hibernate 6 fetching guide](https://docs.hibernate.org/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#fetching) distinguishes direct identifier loading from entity queries for this reason.

The actual count can be less than one query per book. If several books reference the same author, the persistence context can reuse that managed author. A better description is one root query plus additional unresolved associated entities, subject to batching and cache hits.

Changing everything to EAGER therefore changes when loading occurs, not necessarily how efficiently it occurs. It also forces unrelated use cases to retrieve associations they do not need.

### Hidden Traversal and Open Session in View

Association access is not always visible in a service loop. It can happen through:

- Generated `toString()`, `equals()`, or `hashCode()` implementations.
- Jackson property traversal while serializing an entity response.
- Template rendering, debugger property inspection, or logging.
- Mapping code that copies every nested property into another object.

**Open Session in View**, or OSIV, keeps a persistence context available through web rendering. This allows lazy access after the service's transaction has ended, but can move database access into serialization or presentation code. It hides neither the round trips nor their operational cost.

Disabling OSIV exposes missing fetch plans more clearly, often as a `LazyInitializationException`. That exception and N+1 are different problems: closing the context prevents late loading, but does not fetch the required data. Load the response shape inside a deliberate service boundary instead.

## Detecting the Query Pattern

### SQL Logging

For a Spring Boot application using Hibernate 6:

```properties
logging.level.org.hibernate.SQL=DEBUG
logging.level.org.hibernate.orm.jdbc.bind=TRACE
spring.jpa.properties.hibernate.format_sql=true
spring.jpa.properties.hibernate.generate_statistics=true
```

SQL logging reveals repeated statements with the same shape and different parameters. Bind logging helps explain which IDs are being requested, but can expose sensitive data and produce substantial output. Enable it selectively rather than treating it as a permanent production setting.

A database slow-query log may miss the pattern because each individual statement is fast. The request is slow because it performs many individually inexpensive operations. Indexes reduce the work of each child lookup; they do not remove the repeated network exchanges.

### Statistics and Query-Count Assertions

Hibernate statistics can describe prepared statements, entity fetches, collection fetches, and cache activity. The following assertion illustrates a controlled check for a bounded fetch-join operation:

```java
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import static org.junit.jupiter.api.Assertions.assertEquals;

SessionFactory factory = entityManagerFactory.unwrap(SessionFactory.class);
Statistics stats = factory.getStatistics();
stats.setStatisticsEnabled(true);

entityManager.flush();
entityManager.clear();
factory.getCache().evictAllRegions();
stats.clear();

List<Author> authors = entityManager.createQuery(
        "select a from Author a left join fetch a.books", Author.class)
    .getResultList();

authors.forEach(a -> a.getBooks().forEach(Book::getTitle));
assertEquals(1L, stats.getPrepareStatementCount());
```

This assumes an isolated fixture, no unrelated eager paths, no concurrent work sharing the factory counters, and no additional SQL from callbacks or infrastructure. Flush fixture changes before clearing counters so setup writes are not mistaken for reads. Disabling or evicting relevant caches prevents accidental warm-cache success.

`getQueryExecutionCount()` alone is not a complete count of lazy-loading SQL. JDBC-level tools such as **datasource-proxy** can count statement executions through the datasource and attach them to a scoped assertion. Define whether the budget counts executions, preparations, batches, and count queries.

### APM and Request-Level Evidence

An **APM trace** can show a service span containing many repeated database calls. Compare statement fingerprints, their repetition count, total database duration, and connection-pool waiting time. Observe representative page sizes rather than only a single entity.

Query counts should grow in a controlled way. A page of twenty parents should not unexpectedly issue twenty additional child lookups merely because the serializer starts including another property. A query budget is most useful when it accompanies an assertion about the response data, so accidentally omitting children does not appear to be an optimization.

## Fetch Joins

### Fetch the Required Association Explicitly

A **fetch join** asks the provider to initialize the association as part of the entity query:

```java
List<Author> authors = entityManager.createQuery("""
        select a
        from Author a
        left join fetch a.books
        order by a.id
        """, Author.class)
    .getResultList();
```

The SQL now joins authors and books:

```sql
select a.id, a.name, b.id, b.title, b.author_id
from authors a
left join books b on b.author_id = a.id
order by a.id;
```

`left join fetch` retains authors without books. An inner `join fetch` excludes them. A normal `join` can help filtering or projection without initializing the managed collection; the `fetch` keyword changes the loading contract.

For to-one associations, fetching several required references is often practical because they do not multiply root rows like independent collections. A book listing can use `join fetch b.author` to retrieve each book and its author together.

### DISTINCT in Hibernate 6

A collection join returns one SQL row per parent-child combination. Hibernate must combine those rows into parent entities and collections. In **Hibernate 6**, duplicate root entity results caused by collection fetch joins are automatically removed in memory. Adding `select distinct a` solely for that entity de-duplication is no longer necessary.

JPQL `distinct` still has meaning and is passed to SQL in Hibernate 6. It is not a general cure for row explosion, and advice involving Hibernate 5's `passDistinctThrough` hint should not be copied into Hibernate 6 configuration. The [Hibernate 6 query-language guide](https://docs.hibernate.org/orm/6.6/querylanguage/html_single/#hql-select-distinct) documents this behavior.

Removing duplicate Java roots does not reduce the bytes already transferred for repeated parent columns. One query can still be expensive if it returns a large joined result.

### Multiple Collections and Bags

Fetching two independent collections creates a Cartesian multiplication. An author with four books and three awards contributes twelve joined rows, even though the application needs only seven child objects. These are illustrative cardinalities, not performance measurements.

Hibernate can reject simultaneous fetching of multiple **bags** with `MultipleBagFetchException`. A bag allows duplicates without a persistent positional index; a `List` without `@OrderColumn` often has bag semantics, depending on mapping defaults. Not every Java `List` is automatically the same persistence collection type.

Changing a bag to a `Set` just to avoid the exception does not remove the Cartesian product and may change domain semantics. Prefer one bounded collection fetch, separate collection queries in the same persistence context, or a suitable projection.

## Pagination and Collection Fetching

### Why a Row Limit Cannot Be Applied Directly

A SQL row limit counts joined rows, not distinct authors. If the first author has many books, applying `LIMIT 20` to the joined result could truncate that author's collection rather than return twenty complete authors.

For collection fetches combined with `setFirstResult`, `setMaxResults`, or Spring Data pagination, Hibernate 6 can emit:

```text
HHH90003004: firstResult/maxResults specified with collection fetch;
applying in memory
```

Hibernate retrieves the matching joined data and applies the parent pagination in memory. A small returned page therefore does not establish a bounded database result. A collection fetched through an entity graph can encounter the same underlying issue.

Make unsafe pagination fail rather than remain a warning:

```properties
spring.jpa.properties.hibernate.query.fail_on_pagination_over_collection_fetch=true
```

Fetching a to-one association alone normally does not create this collection row-multiplication problem. The query shape still needs review if additional joins multiply roots.

### The Two-Query Approach

First page the parent IDs without fetching a collection. Then fetch the required collection for those IDs:

```java
public List<Author> loadAuthorPage(EntityManager em, int offset, int size) {
    if (offset < 0 || size <= 0) {
        throw new IllegalArgumentException("Invalid page bounds");
    }
    List<Long> ids = em.createQuery("""
            select a.id from Author a order by a.name, a.id
            """, Long.class)
        .setFirstResult(offset)
        .setMaxResults(size)
        .getResultList();

    if (ids.isEmpty()) return List.of();

    List<Author> fetched = em.createQuery("""
            select a from Author a
            left join fetch a.books
            where a.id in :ids
            """, Author.class)
        .setParameter("ids", ids)
        .getResultList();

    Map<Long, Author> byId = fetched.stream().collect(
            java.util.stream.Collectors.toMap(Author::getId, a -> a));
    return ids.stream().map(byId::get).filter(java.util.Objects::nonNull).toList();
}
```

This method assumes standard Jakarta and `java.util` imports and execution inside a service transaction. The unique ID tie-breaker stabilizes ordering. An `IN` predicate does not preserve the input ID order, so the method restores it explicitly. The empty-ID guard avoids an empty `IN` query.

A total count, if required for a `Page`, adds a separate query; the phrase two-query approach refers to selecting and loading the page content. A `Slice` can avoid a total count but may request one extra root to determine whether another page exists.

Data can change between the two statements. Transaction isolation determines whether both see a consistent snapshot; at read committed, a parent might disappear or new children might appear. Stronger consistency requirements need an explicit isolation or application policy. The example omits disappeared parents instead of inventing replacements.

The number of parents is bounded, but a single parent can still have an enormous collection. Fetching a separate child page or returning a count may be better. Large ID lists also encounter database parameter limits and can require chunking. For deep pages, keyset pagination can replace the offset in the first query.

## Entity Graphs

**Entity graphs** describe which attributes a query should fetch without embedding the plan in JPQL text. A named graph can be added to `Author`:

```java
@NamedEntityGraph(
    name = "Author.withBooks",
    attributeNodes = @NamedAttributeNode("books")
)
@Entity
@Table(name = "authors")
public class Author {
    // Use the fields and methods from the earlier Author mapping.
}
```

Apply it to an entity query:

```java
EntityGraph<?> graph = entityManager.getEntityGraph("Author.withBooks");
List<Author> authors = entityManager.createQuery(
        "select a from Author a order by a.id", Author.class)
    .setHint("jakarta.persistence.fetchgraph", graph)
    .getResultList();
```

A **fetch graph** treats specified attributes as eager and unspecified attributes as lazy according to graph semantics. A **load graph**, using `jakarta.persistence.loadgraph`, leaves unspecified attributes at their mapped defaults. Providers may fetch additional state, so a graph is not an exact SQL statement-count contract.

Subgraphs describe nested paths. They are useful for reusable detail views, but including several collections can create the same Cartesian or multiple-bag problems as fetch joins. Graphs also do not make collection pagination safe. Their benefit is declarative plan reuse, not exemption from relational cardinality.

## Batch Fetching

**Batch fetching** groups pending association loads. Instead of selecting one author's books at a time, Hibernate can initialize several collections with one query containing multiple owner IDs.

```java
@OneToMany(mappedBy = "author", fetch = FetchType.LAZY)
@org.hibernate.annotations.BatchSize(size = 16)
private List<Book> books = new ArrayList<>();
```

A default can be configured across the session factory:

```properties
spring.jpa.properties.hibernate.default_batch_fetch_size=16
```

For collections, the size refers to owner collections selected for initialization, not the number of child rows returned. For lazy to-one references, `@BatchSize` can be applied to the associated entity class so multiple unresolved entity proxies can be initialized together.

If forty author collections are available in the same persistence context, a batch size of sixteen can turn forty secondary loads into roughly three grouped loads. The exact number depends on access order, eligible queued owners, caches, lock modes, dialect behavior, and session state. It is a planning estimate rather than a guarantee.

Batch fetching is useful when traversal is conditional or several collections must be loaded without joining them all. It may retrieve data for owners the application never visits and still performs multiple round trips. Load the parent group before traversing associations; repeatedly opening a separate session for each parent prevents useful grouping.

Do not confuse this with **JDBC batching**. `hibernate.jdbc.batch_size` primarily groups write statements; it does not solve read-side N+1. JDBC fetch size also concerns transferring a result set, not combining separate association queries.

## Subselect Fetching

Hibernate's **subselect fetching** can initialize collections for owners associated with an earlier query using that query's restriction as a subselect:

```java
@OneToMany(mappedBy = "author", fetch = FetchType.LAZY)
@org.hibernate.annotations.Fetch(org.hibernate.annotations.FetchMode.SUBSELECT)
private List<Book> books = new ArrayList<>();
```

The conceptual secondary SQL resembles:

```sql
select b.id, b.title, b.author_id
from books b
where b.author_id in (
    select a.id from authors a where a.name like ?
);
```

Triggering one collection load can initialize the same collection role for multiple owners represented by the earlier loading context. This avoids a separate query for every parent and avoids repeating parent columns in a joined result.

The trade-off is breadth: accessing one collection can load many others. The original query's complexity affects the secondary query, and limits or pagination must not be assumed to transfer into an identical bounded owner set. Inspect the actual behavior for the target Hibernate minor version and dialect. SUBSELECT is Hibernate-specific and applies to collections, not a portable JPA solution for every association.

## DTO and Interface Projections

A **DTO projection** retrieves the shape required by a read operation rather than a managed object graph. For a book listing with its author's name:

```java
package com.example.readmodel;

public record BookRow(Long id, String title, String authorName) {}
```

```java
List<BookRow> rows = entityManager.createQuery("""
        select new com.example.readmodel.BookRow(b.id, b.title, a.name)
        from Book b join b.author a
        order by b.id
        """, BookRow.class)
    .getResultList();
```

The constructor signature must match the selected values. Records work well for immutable read models; they are not entities and have no lazy associations or dirty tracking. Selecting scalars is deliberate: putting a managed entity inside a DTO can reintroduce later lazy traversal.

For parent summaries, aggregate in SQL rather than initializing a collection only to count it. A query selecting author ID, name, and `count(b)` with a left join and group by can return zero for authors without books. A nested parent-child DTO generally needs grouping flat rows or separate bulk queries; plain JPQL constructor expressions do not automatically assemble arbitrary nested lists.

Spring Data also supports **interface projections**:

```java
public interface BookView {
    Long getId();
    String getTitle();
    String getAuthorName();
}

public interface BookRepository extends JpaRepository<Book, Long> {
    @Query("""
        select b.id as id, b.title as title, a.name as authorName
        from Book b join b.author a
        order by b.id
        """)
    List<BookView> findBookViews();
}
```

Aliases correspond to projection accessor names. Closed scalar projections can make the selected columns clear. Nested projections and expression-based accessors can materialize more state than expected; a projection is not automatically immune to inefficient loading.

## Spring Data JPA Fetch Plans

Repository methods can attach graphs directly:

```java
public interface AuthorRepository extends JpaRepository<Author, Long> {
    @EntityGraph(attributePaths = "books")
    @Query("select a from Author a order by a.id")
    List<Author> findAllWithBooks();

    @EntityGraph(value = "Author.withBooks", type = EntityGraph.EntityGraphType.FETCH)
    @Query("select a from Author a where a.id in :ids")
    List<Author> findWithBooksByIds(@Param("ids") Collection<Long> ids);
}
```

Here `@EntityGraph` is the Spring Data annotation, while `@NamedEntityGraph` belongs to Jakarta Persistence. Methods are alternative fetch-plan examples, not changes to the global association mapping.

For collection pages, keep a dedicated ID-page method and a second bulk loading method. If a query returns `Page<Author>`, provide a suitable count query when automatic derivation is ambiguous; a count query should not contain a fetch join. A correct count query alone does not fix the content query's collection pagination.

Place the overall read workflow in a service transaction and build DTOs before leaving it. `@Transactional(readOnly = true)` expresses read intent but does not suppress lazy queries, choose a fetch plan, or guarantee identical database isolation on every deployment. Repository method names such as `findAll` do not inherently promise the required associations are loaded.

## The Role of Caching

The **first-level cache** is the persistence context's identity map. It avoids loading the same entity repeatedly within that context. This explains why many books sharing an author do not always produce one author query per book.

The optional **second-level cache** can reuse entity and collection state across contexts. Warm caches may reduce secondary SQL, but collection membership and entity state are separate cache concerns. Cache invalidation, cold starts, and eviction all influence results. The query cache is another feature and should not be confused with cached entity state.

Caching can complement a sound fetch plan. It should not be the only reason a request avoids hundreds of queries, because cold-cache behavior remains part of the system's capacity and latency profile.

## Choosing a Strategy

| Requirement | Suitable Starting Point | Main Trade-Off |
|---|---|---|
| List entities with required to-one data | Fetch join or graph | Wider rows; review other mapped associations |
| Bounded detail view with one collection | Left fetch join or graph | Parent columns repeated for each child |
| Page parents and include collections | Page IDs, then bulk fetch | Multiple statements and consistency considerations |
| Conditional traversal across many owners | Batch fetching | Some over-fetching and several round trips |
| Traverse one collection role for a loaded group | Subselect fetching | Broad initialization and provider-specific behavior |
| Read-only listing or summary | DTO/scalar projection | Separate read model and query maintenance |
| Several independent collections | Separate bulk queries or batches | More statements but avoids Cartesian multiplication |

The target is a bounded amount of useful work, not always one SQL statement. Two small queries can be preferable to one huge join. Count rows and bytes transferred, managed objects created, database execution time, and memory usage alongside query count.

## A Practical Investigation Workflow

Begin with the endpoint's output contract. A page showing author names and book counts needs a different shape from an editing screen that modifies managed books. Write down the required associations, maximum parent page size, and whether child collections are bounded.

Next, inspect the complete request rather than only the repository call. Include DTO mapping and response serialization when identifying the origin of additional statements. Match repeated SQL to the association responsible: a repeated `author_id` predicate suggests collection initialization, while repeated author primary-key lookups suggest unresolved to-one references.

Choose one change at a time and compare equivalent responses. A fetch join that drops authors without books is not equivalent to a left fetch join. A projection that omits required fields is not a complete replacement. Preserve ordering, filtering, empty-parent behavior, and authorization predicates when rewriting the query.

Finally, cover both cold and warm cache conditions and more than one parent cardinality. Include parents with no children, parents sharing a to-one target, and a parent with a larger collection. Check that the pagination guard rejects unsafe collection fetching and that serialization does not introduce additional SQL after service assembly.

This workflow distinguishes round-trip reduction from unrelated improvements such as indexing. Both may be needed, but they address different sources of cost.

## Common Mistakes

- **Replacing LAZY with EAGER everywhere**: eager loading can still use secondary selects and adds work to unrelated use cases.
- **Calling `Hibernate.initialize()` inside a loop**: this makes initialization explicit but can retain the same N+1 pattern without a grouping strategy.
- **Using a normal join as if it were a fetch join**: filtering through an association does not necessarily initialize its collection.
- **Filtering the fetched child collection**: a managed collection can appear complete while containing only the matching subset. Use a separate filtering predicate or a DTO when partial children are intended.
- **Fetching every collection together**: removing N+1 can create Cartesian multiplication or a multiple-bag exception.
- **Adding DISTINCT as a universal repair**: it neither solves round trips nor makes collection pagination bounded.
- **Relying on tiny fixtures or warm caches**: these conceal growth in secondary statements.
- **Returning entities directly to serialization**: the response writer can become an unplanned database client.
- **Ignoring indexes after fixing fetching**: bulk child retrieval still needs appropriate foreign-key and filtering access paths. Not every database automatically indexes foreign keys.

## Conclusion

The N+1 problem is a mismatch between object traversal and the database retrieval plan. Lazy access can reveal it during iteration, while eager mappings can trigger it before the result reaches application code. Neither fetch type is a complete performance policy.

Fetch joins and entity graphs describe required associations. Batch and subselect fetching group deferred loads. DTO projections retrieve read-specific shapes, and paging parent IDs before fetching collections preserves bounded parent pagination without truncating child data.

A reliable approach starts with the response's required fields, makes the service boundary explicit, and observes the resulting SQL under representative conditions. Query budgets, row cardinality, cache behavior, and transaction consistency together show whether the chosen plan does the intended work.
