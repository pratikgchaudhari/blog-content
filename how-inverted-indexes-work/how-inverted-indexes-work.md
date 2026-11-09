---
title: How Inverted Indexes Work - Postings, Phrase Queries, BM25, Lucene and Full-Text Search
date: 2026-11-09
summary: A detailed guide to inverted indexes covering text analysis, postings lists, Boolean and phrase queries, BM25 ranking, segments, compression, distributed search, PostgreSQL GIN, and a Java implementation.
tag: inverted-index, search, lucene, elasticsearch, information-retrieval, databases, data-structures, java
draft: false
related: how-database-indexes-work,b-trees-explained,database-internals,how-apache-kafka-works
---

An **inverted index** is a data structure that maps a term to the documents containing it. Instead of opening every document to find a word, a search engine looks up that word and reads its list of matching document IDs. That reversal, from documents pointing to words to words pointing to documents, gives the index its name.

The idea predates electronic search. A book's index lists subjects and the pages where they appear, while concordances list words and their locations in a collection of texts. Computerized information retrieval developed these ideas into dictionaries, postings lists, and ranking methods. Gerard Salton's SMART project, begun in the 1960s, helped establish statistical approaches to text retrieval. Apache Lucene, originally written by Doug Cutting in 1999, brought a reusable implementation to applications, and later became the indexing foundation for systems such as Elasticsearch and Solr.

This article explains the structure from a small document collection through to production search engines. B-trees organize keys for equality and range lookups. Inverted indexes organize the many terms inside each record, allowing searches to combine words, preserve their order, and rank the matching documents by relevance.

## Why an Inverted Index Exists

A text search can begin with a scan: read each document, split it into words, and check whether the query occurs. This requires work proportional to the collection's text on every query. An index moves much of that work to ingestion time.

There are two useful views of a collection:

| Structure | Key | Value | Useful for |
|---|---|---|---|
| **Forward index** | Document ID | Terms or content in that document | Retrieving a document and analyzing its contents |
| **Inverted index** | Term | Documents containing that term | Finding candidates for a query |

A search system usually keeps both kinds of information. The inverted side finds documents; stored fields or a separate source store provide titles, snippets, and complete records. A matching document ID alone does not contain the text needed to display a result.

The index trades space and write work for faster queries. Every indexed occurrence must be analyzed and represented somewhere, and changing a document requires updating its searchable representation. Whether that trade is worthwhile depends on query frequency, collection size, and the features the search needs.

## The Example Documents

Consider four documents, with zero-based token positions:

```
D1: java search engines
D2: java java indexes
D3: search indexes work
D4: database indexes
```

After splitting on spaces and lowercasing, the forward view is:

```
1 -> [java, search, engines]
2 -> [java, java, indexes]
3 -> [search, indexes, work]
4 -> [database, indexes]
```

Invert that mapping and group occurrences by term:

| Term | Posting: Document ID, Frequency, Positions |
|---|---|
| database | `(4, 1, [0])` |
| engines | `(1, 1, [2])` |
| indexes | `(2, 1, [2]), (3, 1, [1]), (4, 1, [1])` |
| java | `(1, 1, [0]), (2, 2, [0,1])` |
| search | `(1, 1, [1]), (3, 1, [0])` |
| work | `(3, 1, [2])` |

The vocabulary forms the **term dictionary**. Each dictionary entry points to a **postings list**, normally ordered by document ID. Repeated occurrences in one document become one posting with a frequency and an occurrence list, rather than duplicate document IDs.

For `java AND indexes`, the engine intersects `[1,2]` and `[2,3,4]`, producing document 2. It does not examine the original document text to establish that both terms occur.

## Text Analysis

### Tokenization and Normalization

An index contains the output of an **analyzer**, not necessarily the words as originally written. Analysis normally has three stages:

1. **Character filters** transform the input before tokenization, such as removing markup.
2. A **tokenizer** identifies token boundaries.
3. **Token filters** transform, remove, or expand those tokens.

For example:

```
Input:          "Searching JAVA-based indexes!"
Tokenization:   [Searching, JAVA, based, indexes]
Lowercasing:    [searching, java, based, indexes]
Stemming:       [search, java, base, index]
```

This is an illustrative pipeline, not a promise about a particular analyzer. Hyphens, apostrophes, emoji, source code, and languages without whitespace all require deliberate tokenization choices. A product code such as `AB-123` may need to remain whole even when prose is split into words.

**Lowercasing** lets `Java` and `java` match. Accent folding can make accented and unaccented spellings equivalent, but that choice may erase distinctions users care about. An exact identifier field should often use a different analyzer from a paragraph of natural language.

### Stop Words, Stemming, and Synonyms

**Stop words** are common words such as `the` or `and` that an analyzer may remove. Removing them reduces postings, but can damage searches for names or phrases. A search for a title containing only stop words might otherwise produce no searchable terms.

**Stemming** reduces related forms to a common stem, often using rules rather than a dictionary. **Lemmatization** attempts to identify dictionary forms. Both improve recall but can also merge meanings that should remain separate.

Synonyms can expand `car` to include `automobile`. Multiword synonyms need a representation that preserves alternative token paths, not just a flat sequence. Query-time expansion is often easier to change than rewriting an entire indexed collection.

Index-time and query-time analysis must be compatible. They need not be identical, but they must produce terms and positions that can match. Store analyzer configuration as part of the index schema, and treat a change to it as a data migration decision.

## What a Posting Contains

A **posting** can contain several kinds of information:

- **Document ID**: identifies a matching document, often locally within a segment.
- **Term frequency**: the number of occurrences in that document, used in ranking.
- **Positions**: token locations, used in phrase and proximity queries.
- **Offsets**: start and end locations in the source text, useful for highlighting.
- **Payloads**: optional per-occurrence metadata in systems that support it.

Positions count tokens; offsets locate characters or code units. They are different coordinate systems. Removing markup or expanding synonyms makes offset correction especially relevant for accurate highlights. The meaning of an offset must be explicit, particularly when Java strings and UTF-8 storage are involved.

A field does not always need all this information. A keyword filter might require only document IDs, while full-text relevance needs frequencies and field-length statistics. Phrase search requires positions. Omitting unused features saves storage and decoding work, but those features cannot later be recovered from the postings alone.

## Boolean Queries and Intersection

### AND, OR, and NOT

Boolean retrieval combines document sets:

- **AND** computes intersection.
- **OR** computes union, deduplicating documents that occur in both lists.
- **NOT** excludes documents from an existing candidate set or a defined universe of live documents.

For sorted lists, intersection uses two cursors:

```
A:  [1,  2,     7,  9]
B:     [2,  4,  7,     10]
        ^       ^
Result: [2, 7]
```

Compare the current IDs. If equal, emit the ID and advance both cursors. Otherwise advance the cursor holding the smaller ID. For lists of lengths `m` and `n`, the straightforward merge takes at most O(m + n) comparisons.

With several terms, start from the shortest postings list. A rare term provides fewer candidates than a common one. This is why the dictionary's **document frequency**, the number of documents containing a term, helps query planning as well as ranking.

### Skip Data

A long list need not be decoded one ID at a time. **Skip pointers** record selected destinations, letting the reader jump ahead when the next candidate lies beyond a whole section. Multiple levels of skip data form a skip-list-like structure.

Modern block-oriented readers often expose an `advance(targetDocId)` operation. The implementation can jump between blocks and decode only the relevant part. The purpose is the same as a skip list, though the disk representation is not necessarily a conventional pointer-based skip list.

Ranking adds another opportunity: if an upper bound on a block's possible score cannot beat the current top results, the block can be skipped. Techniques such as **Block-Max WAND** use such bounds. Skipping then depends on both document IDs and score potential, rather than membership alone.

## Phrase Queries and Positions

The query `"java search"` asks for more than the presence of two terms. It asks for `search` immediately after `java`.

First intersect the document lists to find documents containing both terms. Then compare position lists within each candidate. A position `p` for `java` must have a corresponding `p + 1` for `search`.

```
D1:
java   -> [0]
search -> [1]
1 = 0 + 1, so "java search" matches

D2:
java   -> [0,1]
search -> absent
No candidate match
```

For a three-term phrase, positions must align at `p`, `p + 1`, and `p + 2`. A **proximity query** relaxes the allowed distance. The meaning of slop, including whether reordered terms are allowed, depends on the engine's query semantics.

Stop-word removal must preserve position gaps. If `the` disappears from `search the indexes`, `indexes` should retain position 2 rather than moving to position 1. Otherwise the exact phrase `search indexes` would incorrectly match it. Positions solve word-order matching, but highlights still need offsets or access to analyzed source text.

## Ranking with TF-IDF and BM25

### From Membership to Relevance

Boolean matching answers whether a document qualifies. **Ranking** decides which qualifying documents should appear first. Two observations underlie many text-ranking models:

- A term occurring several times in a document may be more representative than one occurring once.
- A rare term usually distinguishes documents better than a term occurring almost everywhere.

**TF-IDF** combines **term frequency** with **inverse document frequency**. A simple IDF is `log(N / df)`, where `N` is the number of documents and `df` is the number containing the term. There are many TF-IDF variants, including logarithmic frequency scaling and vector-length normalization.

Raw frequency alone rewards repetition too heavily. Long documents also contain more opportunities to match by accident. **BM25**, developed through the Okapi information retrieval work, addresses these with frequency saturation and length normalization.

### The BM25 Formula

One common positive-IDF form is:

```
IDF(term) = ln(1 + (N - df + 0.5) / (df + 0.5))

lengthFactor = 1 - b + b * documentLength / averageLength

termScore = IDF(term) * frequency * (k1 + 1)
            / (frequency + k1 * lengthFactor)

score(document, query) = sum of termScore for query terms
```

**`k1`** controls frequency saturation. Repeating a term increases its contribution, but each repetition adds less. **`b`** controls length normalization: zero ignores length, while one applies the full relative-length adjustment. Values such as `k1 = 1.2` and `b = 0.75` are common starting points, not universal optimum settings.

Lengths and statistics are normally field-specific. Scoring a title separately from the body permits different boosts and avoids treating every title as part of one undifferentiated document. BM25 scores are ranking values, not probabilities or percentages of relevance.

### A Numerical Example

Our four documents have lengths `3, 3, 3, 2`, so the average is `2.75`. For query `java indexes`:

```
N = 4
java:    df = 2, IDF = ln(2)       = 0.6931
indexes: df = 3, IDF = ln(1.4286)  = 0.3567
```

For a length-3 document, the length factor is approximately `1.0682`. With `k1 = 1.2`, a frequency of 1 gives a multiplier of about `0.9641`; frequency 2 gives about `1.3407`.

| Document | Java Contribution | Indexes Contribution | Total |
|---|---:|---:|---:|
| D1 | 0.6683 | 0 | 0.6683 |
| D2 | 0.9293 | 0.3439 | 1.2732 |
| D3 | 0 | 0.3439 | 0.3439 |
| D4 | 0 | 0.4015 | 0.4015 |

This table uses OR candidate semantics to show every matching document. With AND semantics, only D2 qualifies. D4 receives a larger `indexes` contribution than D3 because the same occurrence appears in a shorter document.

The formula here is a teaching convention. Lucene implementations can omit a query-wide constant factor and use compact field norms, so exact numeric scores need not match these values even when the ranking agrees.

## A Simple Java Inverted Index

The following implementation keeps everything in memory. It supports adding documents, stores token positions, intersects postings for an AND query, and ranks the candidates with the BM25 formula above. Its analyzer deliberately handles only ASCII letters and digits.

```java
import java.util.*;

public class InvertedIndex {
    private final Map<String, NavigableMap<Integer, List<Integer>>> index
            = new HashMap<>();
    private final Map<Integer, Integer> lengths = new HashMap<>();
    private long totalLength;

    record Hit(int documentId, double score) {}

    private static List<String> analyze(String text) {
        List<String> terms = new ArrayList<>();
        for (String term : text.toLowerCase(Locale.ROOT).split("[^a-z0-9]+")) {
            if (!term.isEmpty()) terms.add(term);
        }
        return terms;
    }

    public void add(int id, String text) {
        if (lengths.containsKey(id)) {
            throw new IllegalArgumentException("Duplicate document ID: " + id);
        }
        List<String> terms = analyze(text);
        lengths.put(id, terms.size());
        totalLength += terms.size();
        for (int position = 0; position < terms.size(); position++) {
            index.computeIfAbsent(terms.get(position), key -> new TreeMap<>())
                 .computeIfAbsent(id, key -> new ArrayList<>())
                 .add(position);
        }
    }

    private static List<Integer> intersect(List<Integer> left,
                                           List<Integer> right) {
        List<Integer> result = new ArrayList<>();
        int i = 0, j = 0;
        while (i < left.size() && j < right.size()) {
            int a = left.get(i), b = right.get(j);
            if (a == b) {
                result.add(a);
                i++;
                j++;
            } else if (a < b) {
                i++;
            } else {
                j++;
            }
        }
        return result;
    }

    public List<Hit> searchAnd(String query) {
        List<String> terms = new ArrayList<>(
                new LinkedHashSet<>(analyze(query)));
        if (terms.isEmpty()) return List.of();
        for (String term : terms) {
            if (!index.containsKey(term)) return List.of();
        }
        terms.sort(Comparator.comparingInt(term -> index.get(term).size()));
        List<Integer> candidates = new ArrayList<>(index.get(terms.get(0)).keySet());
        for (int i = 1; i < terms.size() && !candidates.isEmpty(); i++) {
            candidates = intersect(candidates,
                    new ArrayList<>(index.get(terms.get(i)).keySet()));
        }

        double averageLength = (double) totalLength / lengths.size();
        double k1 = 1.2, b = 0.75;
        List<Hit> hits = new ArrayList<>();
        for (int id : candidates) {
            double score = 0;
            double norm = 1 - b + b * lengths.get(id) / averageLength;
            for (String term : terms) {
                NavigableMap<Integer, List<Integer>> postings = index.get(term);
                int df = postings.size();
                int frequency = postings.get(id).size();
                double idf = Math.log(1 + (lengths.size() - df + 0.5) / (df + 0.5));
                score += idf * frequency * (k1 + 1) / (frequency + k1 * norm);
            }
            hits.add(new Hit(id, score));
        }
        hits.sort(Comparator.comparingDouble(Hit::score).reversed()
                            .thenComparingInt(Hit::documentId));
        return hits;
    }

    public static void main(String[] args) {
        InvertedIndex search = new InvertedIndex();
        search.add(1, "java search engines");
        search.add(2, "java java indexes");
        search.add(3, "search indexes work");
        search.add(4, "database indexes");
        System.out.println(search.searchAnd("java indexes"));
    }
}
```

A posting's position-list size supplies its frequency. `TreeMap` maintains document order even when documents arrive out of order. Duplicate query terms are collapsed, so repeated words in a query do not add extra weight. Empty analyzed queries return no results.

The implementation rejects duplicate IDs instead of silently mixing old and new occurrences. Empty documents count towards its collection statistics, but cannot match a term. If there is a candidate, at least one indexed token exists, so the average length is positive.

This is a single-threaded teaching structure, not a disk index. It allocates boxed integers and copies postings during intersection. It has no deletion, persistence, skip data, field model, phrase-query API, or bounded top-k heap. Positions are stored so the phrase algorithm described earlier could be added without changing the index shape.

## Building an Index with Segments

### From Memory to Immutable Files

A large index cannot remain a map of Java objects. An indexing process analyzes incoming documents, accumulates terms and postings in memory, and writes a sorted **segment** when buffers reach a threshold.

A segment is a self-contained searchable index with its own dictionary, postings, and document numbering. Lucene's model relies heavily on immutable segment data:

```
Incoming documents
        |
        v
 Analysis and RAM buffers
        |
        v
 Segment A   Segment B   Segment C
      \          |          /
       \---------+---------/
                 |
                 v
           Merged segment D
```

Immutability allows readers to keep using a stable segment while writers create new ones. The engine searches multiple segments and combines their results. Segment-local document IDs are implementation details, not permanent business identifiers.

### Merging, Updates, and Deletes

Too many small segments increase per-query overhead. Background **merges** combine segments, rewrite compressed data, and reclaim deleted documents. A merge is substantial I/O work, not a free reorganization.

A deletion normally marks a document as no longer live using deletion metadata, conceptually a **tombstone**. Search filters out dead documents even though their postings remain until reclamation. Updating a full document generally means deleting the old version and indexing a replacement. Specialized numeric or binary value updates are separate mechanisms.

Frequent replacements therefore create write amplification: data enters a fresh segment and may be rewritten through later merges. Merge policy balances segment count, background resource use, and reclaimable space. Applications should not retain segment-local IDs across refreshes or merges.

### Near-Real-Time Refresh

A **refresh** makes newly indexed content visible by opening a reader over a newer index view. In a near-real-time system this can happen without a durable Lucene commit. Readers already serving requests retain their earlier snapshot until replaced or closed.

Search visibility and crash durability are separate concerns. A search service may acknowledge writes using a durable transaction log before a refresh exposes them. Conversely, opening a searchable segment does not by itself prove that every relevant file has reached durable storage.

A shorter refresh interval reduces visibility delay but can produce more small segments and additional merge work. Exact defaults depend on the product, deployment, and index activity. Applications needing read-after-write search behavior should request an appropriate visibility guarantee rather than assume immediate searchability.

## Compression and the Term Dictionary

### Delta Encoding and Variable Bytes

Sorted document IDs compress well because gaps are often smaller than absolute values:

```
Document IDs:  [100, 103, 104, 120]
Gaps:         [100,   3,   1,  16]
```

**Delta encoding** stores the first ID and successive gaps. Decoding uses prefix sums to reconstruct the originals. Positions within a document can use the same approach.

**Variable-byte encoding** represents small non-negative integers with fewer bytes than large ones, using continuation information to mark boundaries. A conventional seven-data-bits-per-byte representation needs one byte for values below 128. Different formats choose different continuation-bit conventions, so a decoder must follow its codec precisely.

### FOR, PFOR, and Roaring Bitmaps

**Frame of Reference** compression groups integers into blocks and represents them relative to a base, with a shared bit width. For postings gaps, block bit-packing can operate directly on the deltas. The largest value determines the width needed for the block.

**Patched FOR** avoids making every value wide just because a few values are large. Most values use a narrow width and exceptional values are recorded separately. The result trades decoding complexity for smaller blocks. Search codecs vary by version and may use different block sizes or encoding families.

**Roaring bitmaps** partition the integer space into containers and choose representations such as sorted arrays or bitmaps according to local density, with run containers available for consecutive ranges. They support fast set operations and are useful for filters and document sets.

A bitmap is not a complete positional index. It expresses membership but does not by itself supply frequency, positions, and offsets. Sparse and dense term lists also have different costs, so no single compression format wins everywhere.

### FSTs and Term Lookup

Before decoding postings, the engine must locate a term. A hash map is convenient in memory, but a disk-oriented vocabulary benefits from ordering and shared structure.

A **finite-state transducer**, or **FST**, maps input strings to outputs through a compact automaton. Compatible paths and states can be shared, reducing duplication across related terms. Outputs can identify postings metadata or term-dictionary blocks.

Lucene's dictionary implementation depends on the codec. Block-tree designs group terms into blocks and use a compact prefix index; FST-based structures have been used to locate those blocks, while other codecs can map terms more directly. Saying every Lucene version stores every full term and all metadata in one FST is too broad.

Dictionary structure also affects prefix and wildcard queries. A prefix narrows the vocabulary region to enumerate, but a broad wildcard can still expand to many terms and postings lists. Index lookup does not make an arbitrarily expansive query cheap.

## Distributed Search

Search engines commonly **shard by document**. Each document belongs to one shard, and each shard has its own inverted index. A term such as `java` can therefore appear in the dictionaries of many shards.

```
                 Query coordinator
                /        |        \
               v         v         v
            Shard 1   Shard 2   Shard 3
            local     local     local
            top-k     top-k     top-k
                \        |        /
                 v       v       v
                  Merge results
```

The coordinator performs **scatter-gather**: send the query to relevant shards, collect candidate IDs and scores, merge the ranked lists, then fetch the fields needed for display. Replicas provide availability and can serve reads, but a query ordinarily chooses one copy of each logical shard.

With comparable scores and a simple global top-k request, each shard's local top-k contains enough candidates. Deep pagination, reranking, result collapsing, or approximate retrieval can require different collection strategies.

Ranking statistics are a complication. Local document frequencies and average lengths can differ between shards, making local BM25 scores less comparable. Some systems offer an extra distributed-statistics phase; this costs coordination work. Routing documents by tenant or category can make statistical skew especially noticeable.

## PostgreSQL GIN and Full-Text Search

PostgreSQL provides full-text search without requiring a separate search cluster. **`tsvector`** represents normalized lexemes and optional positions; **`tsquery`** represents the query expression. A **GIN**, or Generalized Inverted Index, maps indexed components to matching rows.

```sql
CREATE TABLE articles (
    id bigint PRIMARY KEY,
    body text NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS
        (to_tsvector('english'::regconfig, body)) STORED
);

CREATE INDEX articles_search_idx ON articles USING GIN (search_vector);

SELECT id,
       ts_rank(search_vector, websearch_to_tsquery('english', 'java indexes')) AS rank
FROM articles
WHERE search_vector @@ websearch_to_tsquery('english', 'java indexes')
ORDER BY rank DESC, id;
```

Use the same text-search configuration when constructing the vector and query. The [PostgreSQL documentation](https://www.postgresql.org/docs/current/textsearch-indexes.html) recommends GIN for text-search indexing. GIN narrows candidates by lexemes; it does not store all `tsvector` information, including weight labels. Phrase conditions and weight-sensitive conditions can require checking the row's vector.

Built-in `ts_rank` and `ts_rank_cd` are not BM25. Nor does a GIN index automatically provide an index-ordered top-k BM25 scan. The query may need to retrieve and score many matching rows before sorting them.

PostgreSQL is attractive when search must stay close to transactional data and the required features fit its model. A dedicated search engine adds another replicated view of the data, synchronization lag, and operational work, but offers a wider search-specific feature set. Neither choice removes the need to design analyzers, relevance, and update behavior.

## Common Mistakes

- **Using substring expectations for token search**: `cat` does not automatically match `concatenate`. Prefixes, n-grams, and substring search are different features with different storage costs.
- **Ignoring analysis differences**: inconsistent normalization makes apparently identical words fail to match.
- **Discarding positions too early**: frequencies alone cannot answer exact phrase queries.
- **Treating BM25 as semantic understanding**: lexical ranking cannot infer every paraphrase or resolve every meaning.
- **Keeping obsolete postings live**: updates need deletion handling and consistent document identity.
- **Confusing refresh with durability**: searchable and safely recoverable are separate properties.
- **Assuming all matches must be scored**: top-k pruning can avoid work, but needs valid score bounds and suitable query execution.
- **Ignoring access control**: authorization filters must constrain retrieval, not merely hide items after a small top-k set has already been chosen.

## Cheat Sheet

| Concept | Purpose |
|---|---|
| Forward index | Document to terms or stored content |
| Inverted index | Term to matching documents |
| Analyzer | Converts input into searchable tokens |
| Document frequency | Documents containing a term |
| Term frequency | Occurrences within one document |
| Positions | Phrase and proximity matching |
| Offsets | Locating source spans for highlighting |
| AND query | Intersect ordered postings |
| Skip data | Jump over irrelevant posting ranges |
| BM25 | Saturating term frequency plus rarity and length adjustment |
| Segment | Self-contained index unit |
| Merge | Combine segments and reclaim dead data |
| Refresh | Expose a newer searchable view |
| Delta encoding | Store gaps between sorted integers |
| FST | Compact string-to-output mapping |
| GIN | PostgreSQL inverted access method for component membership |

## Conclusion

An inverted index turns text search into a lookup followed by operations on ordered document sets. Analysis determines what can match. Postings supply membership, frequency, and positional evidence. Query execution combines those postings, and ranking methods such as BM25 determine which candidates should appear first.

Production systems add immutable segments, compression, deletion tracking, reader refreshes, and distributed result collection. These mechanisms keep the basic mapping usable as documents accumulate and change. Understanding that mapping, and the distinction between matching, ranking, visibility, and durability, provides a practical foundation for building and choosing a search system.
