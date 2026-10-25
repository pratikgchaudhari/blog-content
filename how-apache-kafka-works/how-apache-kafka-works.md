---
title: Apache Kafka Explained - Architecture, Internals, and Real-World Use Cases
date: 2026-10-25
summary: A detailed guide to Apache Kafka covering topics, partitions, brokers, producers, consumers, replication, delivery guarantees, KRaft, and the ecosystem, with code examples and practical tips.
tag: kafka, apache-kafka, event-streaming, distributed-systems, messaging, system-design, java, backend
draft: false
---

Apache Kafka is a distributed event streaming platform. At its core, it is a durable, replicated, append-only log that many applications can write to and read from at the same time, at very high throughput. Companies use it to move data between services, process streams of events in real time, collect logs and metrics, and keep databases, search indexes, and caches in sync.

Kafka was built at LinkedIn around 2010 to handle the company's activity data and operational metrics, and was open-sourced in 2011. It became a top-level Apache project in 2012. According to the Apache Kafka project, it is used by more than 80% of Fortune 100 companies, and an entire ecosystem (Kafka Connect, Kafka Streams, Schema Registry, and managed services such as Confluent Cloud and Amazon MSK) has grown around it.

This article explains how Kafka works, from the basic concepts to the internals that make it fast and reliable, and when it is (and isn't) the right tool.

## Why Kafka Exists

Imagine a company with a handful of services: orders, payments, inventory, notifications, analytics, and search. Each one needs data from several others. If every service talks directly to every other service, the number of point-to-point integrations grows quickly, each with its own format, retry logic, and failure modes. When one system is slow or down, its failures spread to everything that depends on it.

Kafka replaces that web of connections with a central stream of events:

```
Before:                                   After:

Orders ---> Payments                      Orders ---\                /---> Payments
   |   \--> Inventory                     Payments --\              /----> Inventory
   |    \-> Analytics                     Inventory ----> Kafka ---------> Analytics
   \------> Search                        Users ------/             \----> Search
Users  ---> Analytics ...                                            \---> Notifications
```

Producers publish events such as "order placed" or "payment captured" once. Any number of consumers can read them, at their own pace, without the producer knowing or caring who they are. Because Kafka stores events durably for a configurable period, a new consumer can even start from the beginning and replay history.

## Core Concepts

### Events (Records)

An **event**, or **record**, is the unit of data in Kafka. It records that something happened. Each record has:

- A **key** (optional), used to decide which partition the record goes to and to keep related records in order.
- A **value**, the payload, usually JSON, Avro, or Protobuf.
- A **timestamp**.
- Optional **headers**, small key-value metadata such as a trace ID.

```
key:       "order-1042"
value:     {"orderId": 1042, "customerId": 77, "total": 2499.00, "status": "PLACED"}
timestamp: 2026-10-25T12:56:10.123Z
headers:   {"traceId": "a1b2c3", "source": "order-service"}
```

### Topics

A **topic** is a named stream of related records, such as `orders`, `payments`, or `page-views`. You can think of it like a table in a database or a folder of files, except that records are only ever appended, never modified in place.

Records are not deleted when they are consumed. They stay in the topic until the **retention** policy removes them, for example after seven days or once the topic reaches a certain size. This is a key difference from traditional message queues, which delete a message once it has been delivered.

### Partitions

Each topic is split into one or more **partitions**. A partition is an ordered, immutable sequence of records, stored as a log on disk. Every record in a partition gets a sequential ID called an **offset**.

```
Topic: orders (3 partitions)

Partition 0:  [0] [1] [2] [3] [4] [5] [6]  --> new records appended here
Partition 1:  [0] [1] [2] [3]
Partition 2:  [0] [1] [2] [3] [4] [5]
```

Partitions are what make Kafka scale. They let a topic be spread across many servers and read by many consumers in parallel.

Two rules are important:

- **Ordering is guaranteed only within a partition**, not across a whole topic.
- **Records with the same key always go to the same partition** (as long as the number of partitions doesn't change), because the default partitioner hashes the key. So if you use `orderId` as the key, every event for order 1042 lands in the same partition and is read in the order it was written.

Records without a key are spread across partitions. Modern Kafka clients use a "sticky" approach, filling a batch for one partition before moving to the next, which gives better batching than strict round-robin.

### Brokers and Clusters

A **broker** is a Kafka server. It stores partitions on its disks and serves reads and writes for them. A **cluster** is a group of brokers working together. Partitions of a topic are distributed across the brokers, so the load is shared.

```
              Kafka cluster
+-------------+-------------+-------------+
|  Broker 1   |  Broker 2   |  Broker 3   |
|-------------|-------------|-------------|
| orders-P0 L | orders-P0 F | orders-P1 L |
| orders-P2 F | orders-P1 F | orders-P2 L |
| ...         | ...         | orders-P0 F |
+-------------+-------------+-------------+
L = leader replica, F = follower replica
```

Clients connect to any broker (a **bootstrap server**), fetch the cluster's metadata, and from then on talk directly to whichever broker leads the partition they need.

### Producers

A **producer** is an application that writes records to topics. It decides which partition each record goes to, batches records together, compresses them, and sends them to the leader of each partition.

### Consumers and Consumer Groups

A **consumer** reads records from topics. Consumers **pull** data from brokers rather than having it pushed to them, which lets each consumer read at its own pace and makes it easy to replay data.

Consumers work together in a **consumer group**, identified by a `group.id`. Kafka assigns each partition of a topic to exactly one consumer in the group, so the group shares the work:

```
Topic: orders (4 partitions)

Consumer group "billing"           Consumer group "analytics"
+------------+------------+        +-----------------------+
| Consumer A | Consumer B |        |      Consumer X       |
|  P0, P1    |  P2, P3    |        |   P0, P1, P2, P3      |
+------------+------------+        +-----------------------+
```

Key points:

- Each group gets **every** record in the topic. The `billing` and `analytics` groups above both see all orders, independently.
- **Within** a group, each partition is read by only one consumer, which preserves per-partition ordering.
- The number of partitions caps the useful parallelism of a group. With 4 partitions, a 5th consumer in the same group would sit idle.

This one model gives you both styles of messaging. Many consumers in one group behave like a work queue, while many groups on one topic behave like publish-subscribe.

### Offsets and Commits

Each consumer group tracks, per partition, the offset of the next record it should read. Consumers **commit** these offsets back to Kafka, which stores them in an internal topic called `__consumer_offsets`. If a consumer crashes or restarts, it (or whichever consumer takes over its partitions) resumes from the last committed offset.

```
Partition 0: [0] [1] [2] [3] [4] [5] [6] [7] [8]
                              ^           ^       ^
                     committed offset   current   log end
                       (resume here)   position   offset
```

The difference between the log end offset and the committed offset is the **consumer lag**: how far behind the group is. Lag is one of the most important metrics to monitor.

## How Kafka Stores Data

Much of Kafka's speed comes from how simply it stores data.

### The Log on Disk

Each partition is a directory on a broker's disk. Inside it, the log is split into **segments**, files of up to 1 GB by default. Only the newest segment, the **active segment**, is written to. Each segment has accompanying index files:

```
/var/lib/kafka/data/orders-0/
    00000000000000000000.log        # records with offsets 0 to 48,211
    00000000000000000000.index      # offset -> position in the .log file
    00000000000000000000.timeindex  # timestamp -> offset
    00000000000000048212.log        # active segment
    00000000000000048212.index
    00000000000000048212.timeindex
```

The segment's file name is the first offset it contains. To find offset 50,000, Kafka picks the segment whose base offset is just below it, looks up the nearest entry in the sparse `.index` file, and scans forward a short distance in the `.log` file.

### Why Kafka Is So Fast

Kafka routinely handles millions of records per second on modest clusters. Several design choices make that possible:

- **Sequential I/O.** Records are only ever appended to the end of a file and read in order. Sequential disk access is dramatically faster than random access, on both spinning disks and SSDs.
- **The OS page cache.** Kafka doesn't keep its own large in-memory cache. It relies on the operating system's page cache, so recently written data is usually still in memory when consumers read it.
- **Zero-copy transfer.** When sending data to consumers, Kafka uses the `sendfile` system call to copy bytes from the page cache straight to the network socket, skipping copies into the application's memory. (This doesn't apply when TLS encryption is on, since data must be encrypted in user space.)
- **Batching.** Producers group many records into one request, and brokers write and serve them as batches. This cuts per-record overhead on the network and disk.
- **Compression.** Whole batches are compressed (gzip, Snappy, LZ4, or Zstandard) by the producer, stored compressed on the broker, and only decompressed by the consumer.
- **A simple broker.** Brokers don't track per-message delivery state for each consumer. Consumers keep track of their own position with a single offset per partition.

### Retention and Log Compaction

Kafka removes old data in one of two ways, set per topic with `cleanup.policy`:

**Delete (the default):** whole segments are deleted once they are older than `retention.ms` (7 days by default) or the partition grows beyond `retention.bytes`.

**Compact:** Kafka keeps at least the **latest value for every key** and removes older values for the same key. A record with a key and a `null` value (a **tombstone**) marks the key as deleted, and is itself removed after a while.

```
Before compaction:                 After compaction:
offset key    value                offset key    value
0      user1  {city: Pune}         2      user2  {city: Delhi}
1      user1  {city: Mumbai}       3      user1  {city: Bengaluru}
2      user2  {city: Delhi}        4      user3  {city: Chennai}
3      user1  {city: Bengaluru}
4      user3  {city: Chennai}
```

Compacted topics are ideal for storing the current state of entities, such as the latest profile per user or the latest price per product. Kafka itself uses compaction for `__consumer_offsets`.

### Tiered Storage

Since Kafka 3.6 (and production-ready in 3.9), **tiered storage** lets brokers move older segments to cheaper remote storage such as Amazon S3, while keeping recent data on local disks. Consumers read old data transparently. This makes very long retention affordable and makes brokers faster to replace or rebalance, since they hold less data locally.

## Replication and Fault Tolerance

Kafka makes data durable by keeping copies of each partition on several brokers.

### Leaders and Followers

Each partition has a **replication factor**, typically 3. One replica is the **leader**. All writes, and by default all reads, go through it. The other replicas are **followers**, which continuously fetch new records from the leader to stay up to date. Kafka spreads leaders across brokers so the load is balanced, and with rack awareness (`broker.rack`) it places replicas in different racks or availability zones.

### In-Sync Replicas (ISR)

The **in-sync replica set** is the leader plus the followers that are fully caught up, meaning they have fetched from the leader within `replica.lag.time.max.ms` (30 seconds by default). A follower that falls behind is removed from the ISR, and added back once it catches up.

The **high watermark** is the highest offset that every replica in the ISR has. Consumers can only read up to the high watermark, so they never see a record that could be lost if the leader failed.

### Leader Election

If a broker fails, the cluster's controller picks a new leader for each of its partitions from the remaining in-sync replicas. Clients notice the change, refresh their metadata, and carry on, usually within seconds.

If no in-sync replica is left, Kafka by default waits rather than electing an out-of-date replica. Setting `unclean.leader.election.enable=true` allows it, which restores availability faster but can lose committed data. It's a trade-off between availability and durability.

### Durability Settings

Three settings work together to decide how safe a write is:

| Setting | Where | Meaning |
| --- | --- | --- |
| `acks=0` | Producer | Don't wait for any acknowledgement. Fastest, but records can be lost silently. |
| `acks=1` | Producer | Wait for the leader to write the record. Lost if the leader dies before followers copy it. |
| `acks=all` | Producer | Wait until every in-sync replica has the record. The default since Kafka 3.0. |
| `min.insync.replicas` | Topic or broker | The minimum ISR size for an `acks=all` write to succeed. |
| `replication.factor` | Topic | How many copies of each partition exist. |

A common production setup is `replication.factor=3`, `min.insync.replicas=2`, and `acks=all`. The cluster can lose one broker and keep accepting writes with no data loss. If two brokers are down, writes to the affected partitions fail with `NotEnoughReplicas` rather than accepting data that only one machine holds.

## KRaft: Kafka Without ZooKeeper

For most of its history, Kafka relied on **Apache ZooKeeper**, a separate coordination service, to store cluster metadata (brokers, topics, partitions, configurations) and to elect a controller broker. Running and securing two distributed systems added complexity, and ZooKeeper limited how many partitions a cluster could handle.

**KRaft** (Kafka Raft) replaces ZooKeeper with a built-in consensus protocol based on Raft. A small set of **controller** nodes (usually three) stores metadata in an internal, replicated log called `__cluster_metadata`. One controller is the active leader, and brokers keep a local copy of the metadata by following that log.

```
          +-------------------------------------+
          |    KRaft controller quorum          |
          |  Controller 1 (active) <-> C2 <-> C3 |
          +------------------+------------------+
                             |  metadata log
         +-------------------+-------------------+
         |                   |                   |
     Broker 1            Broker 2            Broker 3
```

Benefits include a single system to deploy and secure, much faster controller failover, and support for far more partitions per cluster. KRaft became production-ready in Kafka 3.3, and **Kafka 4.0 (released in 2025) removed ZooKeeper support entirely**, so every new cluster runs in KRaft mode.

## Producers in Depth

### A Simple Java Producer

```java
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
props.put(ProducerConfig.LINGER_MS_CONFIG, 10);
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");

try (KafkaProducer<String, String> producer = new KafkaProducer<>(props)) {
    ProducerRecord<String, String> record = new ProducerRecord<>(
            "orders",
            "order-1042",
            "{\"orderId\":1042,\"customerId\":77,\"total\":2499.00,\"status\":\"PLACED\"}");

    producer.send(record, (metadata, exception) -> {
        if (exception != null) {
            log.error("Failed to send order event", exception);
        } else {
            log.info("Sent to partition {} at offset {}", metadata.partition(), metadata.offset());
        }
    });
}
```

`send()` is asynchronous. It adds the record to an in-memory buffer and returns immediately; a background thread batches and sends records, then calls the callback.

### How a Record Gets Sent

1. The record is **serialised** into bytes.
2. The **partitioner** chooses a partition, by hashing the key or using the sticky strategy for keyless records.
3. The record is added to a **batch** for that partition in the `RecordAccumulator` buffer.
4. A batch is sent when it reaches `batch.size` (16 KB by default) or after `linger.ms` (5 ms by default in Kafka 4.0, previously 0) has passed.
5. The leader broker writes the batch and replies according to the `acks` setting.
6. On a retriable error, such as a leader change, the producer retries automatically until `delivery.timeout.ms` (2 minutes by default) runs out.

### Throughput and Latency Tuning

- Increase `linger.ms` and `batch.size` to send fewer, larger batches. This raises throughput at the cost of a few milliseconds of latency.
- Enable `compression.type`, with `lz4` or `zstd` as good general choices.
- Increase `buffer.memory` if the producer frequently blocks because the buffer is full.

### Idempotent Producers

Retries can create duplicates. If the broker writes a batch but the acknowledgement is lost, the producer sends it again. An **idempotent producer** prevents this. Each producer gets an ID, and each batch carries a sequence number per partition, so the broker detects and discards duplicates. It also keeps records in order across retries. Idempotence is enabled by default since Kafka 3.0.

## Consumers in Depth

### A Simple Java Consumer

```java
Properties props = new Properties();
props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ConsumerConfig.GROUP_ID_CONFIG, "billing-service");
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);

try (KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props)) {
    consumer.subscribe(List.of("orders"));

    while (running) {
        ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(500));
        for (ConsumerRecord<String, String> record : records) {
            processOrder(record.key(), record.value());
        }
        consumer.commitSync();   // commit only after the whole batch is processed
    }
}
```

`auto.offset.reset` decides where a group starts when it has no committed offset: `earliest` (the beginning of the partition) or `latest` (only new records, the default).

### Committing Offsets

When you commit an offset relative to processing determines your delivery guarantee:

- **Auto-commit** (`enable.auto.commit=true`, the default) commits periodically in the background. It's convenient, but if the consumer crashes, records may be reprocessed, or, in some patterns, skipped.
- **Commit after processing** (as above) gives **at-least-once** delivery. A crash after processing but before committing means some records are processed again, so processing should be idempotent.
- **Commit before processing** gives **at-most-once** delivery. A crash after committing but before processing means those records are skipped.

`commitSync()` waits for the commit and retries on failure. `commitAsync()` doesn't block, and is often used in the loop with a final `commitSync()` on shutdown.

### Rebalancing

When a consumer joins or leaves a group, or crashes, Kafka **rebalances**, redistributing partitions among the remaining members. A consumer is considered dead if it stops sending heartbeats for `session.timeout.ms` (45 seconds by default), or if it takes longer than `max.poll.interval.ms` (5 minutes by default) between calls to `poll()`.

Rebalances used to be disruptive, because the classic protocol had every consumer give up all its partitions and stop processing until the new assignment was ready. Improvements over the years have reduced this:

- **Cooperative incremental rebalancing** (`CooperativeStickyAssignor`) moves only the partitions that need to move, while consumers keep processing the rest.
- **Static membership** (`group.instance.id`) lets a consumer restart, for example during a rolling deploy, without triggering a rebalance, as long as it returns within the session timeout.
- **The new consumer group protocol** (KIP-848), generally available in Kafka 4.0 with `group.protocol=consumer`, moves assignment logic to the broker and makes rebalances incremental and much less disruptive by design.

A common cause of unnecessary rebalances is slow processing inside the poll loop. If handling a batch can take a long time, reduce `max.poll.records` or increase `max.poll.interval.ms`.

## Delivery Semantics

Kafka can provide three levels of delivery guarantee:

| Guarantee | What it means | How you get it |
| --- | --- | --- |
| At-most-once | Records may be lost, never duplicated | Commit offsets before processing; `acks=0` or `1` |
| At-least-once | Records are never lost, may be duplicated | `acks=all`, retries, commit after processing |
| Exactly-once | Each record's effect happens exactly once | Idempotent producer plus transactions, within Kafka |

### Exactly-Once Semantics and Transactions

Kafka supports **transactions**, which let a producer write to multiple partitions and topics atomically: either all the records become visible, or none do. Combined with committing consumer offsets inside the same transaction, this enables exactly-once **read-process-write** pipelines.

```java
producerProps.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "order-enricher-1");
KafkaProducer<String, String> producer = new KafkaProducer<>(producerProps);
producer.initTransactions();

consumerProps.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed");
consumerProps.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);

while (running) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(500));
    if (records.isEmpty()) continue;

    producer.beginTransaction();
    try {
        for (ConsumerRecord<String, String> record : records) {
            String enriched = enrich(record.value());
            producer.send(new ProducerRecord<>("orders-enriched", record.key(), enriched));
        }
        // Commit the consumer's offsets as part of the same transaction
        producer.sendOffsetsToTransaction(currentOffsets(records), consumer.groupMetadata());
        producer.commitTransaction();
    } catch (ProducerFencedException e) {
        producer.close();   // another instance with the same transactional.id took over
        throw e;
    } catch (KafkaException e) {
        producer.abortTransaction();
        // rewind the consumer to the last committed offsets before retrying
    }
}
```

Consumers that set `isolation.level=read_committed` only see records from committed transactions.

The important caveat: exactly-once applies **within Kafka**. If your consumer writes to an external database or calls an API, Kafka can't make that side effect atomic with its offsets. In that case, use idempotent writes (such as upserts keyed by event ID), store offsets in the same database transaction as the results, or use the **transactional outbox** pattern.

## The Kafka Ecosystem

### Kafka Connect

**Kafka Connect** is a framework for moving data between Kafka and other systems without writing custom code. **Source connectors** bring data into Kafka, and **sink connectors** push data out.

Examples include JDBC databases, Debezium for change-data-capture from MySQL and PostgreSQL, Amazon S3, Elasticsearch, MongoDB, and Snowflake. Connectors are configured with JSON and run on a scalable, fault-tolerant cluster of Connect workers.

```json
{
  "name": "orders-to-s3",
  "config": {
    "connector.class": "io.confluent.connect.s3.S3SinkConnector",
    "topics": "orders",
    "s3.bucket.name": "company-data-lake",
    "s3.region": "ap-south-1",
    "format.class": "io.confluent.connect.s3.format.parquet.ParquetFormat",
    "flush.size": "10000",
    "tasks.max": "4"
  }
}
```

### Kafka Streams

**Kafka Streams** is a Java library for building stream processing applications that read from and write to Kafka. It supports filtering, mapping, joins, windowed aggregations, and local state stores, and it scales by simply running more instances of your app. It also supports exactly-once processing with `processing.guarantee=exactly_once_v2`.

```java
StreamsBuilder builder = new StreamsBuilder();

KStream<String, Order> orders = builder.stream("orders",
        Consumed.with(Serdes.String(), orderSerde));

// Revenue per customer over 5-minute windows
orders
    .filter((key, order) -> order.status().equals("PAID"))
    .groupBy((key, order) -> String.valueOf(order.customerId()),
             Grouped.with(Serdes.String(), orderSerde))
    .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofMinutes(5)))
    .aggregate(() -> 0.0,
               (customerId, order, total) -> total + order.total(),
               Materialized.with(Serdes.String(), Serdes.Double()))
    .toStream()
    .map((windowedKey, total) -> KeyValue.pair(windowedKey.key(), total))
    .to("customer-revenue-5m", Produced.with(Serdes.String(), Serdes.Double()));

KafkaStreams streams = new KafkaStreams(builder.build(), streamsProps);
streams.start();
```

Other popular stream processors that work with Kafka include Apache Flink, Spark Structured Streaming, and SQL-based tools such as ksqlDB.

### Schema Registry

Producers and consumers must agree on the format of records. A **Schema Registry** (from Confluent, Apicurio, or AWS Glue) stores Avro, Protobuf, or JSON Schema definitions for each topic. Producers register schemas, records carry a small schema ID, and consumers fetch the schema to deserialise them. The registry also enforces **compatibility rules** (backward, forward, or full), so a producer can't deploy a change, such as removing a required field, that would break existing consumers.

## Common Use Cases

### Event-Driven Microservices

Services publish domain events (`OrderPlaced`, `PaymentCaptured`, `ItemShipped`) and others react to them. Services are decoupled: the order service doesn't need to know that a loyalty-points service exists, and that new service can be added later without changing anyone else.

### Real-Time Analytics and Monitoring

Clickstreams, application events, and IoT sensor data are streamed into Kafka and processed in real time, for live dashboards, alerting, or anomaly detection.

### Log and Metrics Aggregation

Kafka collects logs and metrics from thousands of servers and acts as a buffer in front of systems like Elasticsearch, ClickHouse, or a data lake, absorbing bursts that would otherwise overwhelm them.

### Change Data Capture (CDC)

Tools like Debezium read a database's transaction log (the MySQL binlog or PostgreSQL WAL) and publish every insert, update, and delete as an event. Other systems, such as search indexes, caches, data warehouses, and other microservices, stay in sync with the database without the application dual-writing.

### Event Sourcing and CQRS

Instead of storing only current state, some systems store every change as an immutable event and derive state from it. Kafka's durable, replayable, ordered log makes it a natural backbone, often with compacted topics holding the latest state.

### Data Pipelines and Integration

Kafka acts as a central hub between operational systems and analytical ones, feeding data lakes, warehouses, and machine learning feature stores, often through Kafka Connect.

### Fraud Detection and Real-Time Decisions

Payment and transaction events are scored as they happen with stream processors, so suspicious activity can be blocked within milliseconds rather than discovered in a nightly batch job.

## Kafka vs Traditional Message Queues

| Aspect | Kafka | RabbitMQ / ActiveMQ (traditional queues) |
| --- | --- | --- |
| Model | Distributed, replicated log | Message broker with queues and exchanges |
| After consumption | Records stay until retention removes them | Messages are usually deleted once acknowledged |
| Replay | Yes, by resetting offsets | Generally no (RabbitMQ Streams add log-style replay) |
| Ordering | Per partition | Per queue, weaker with competing consumers |
| Throughput | Very high, millions of records per second | High, but typically lower |
| Consumer model | Pull, with offsets per group | Mostly push, with per-message acknowledgements |
| Routing | Simple, by topic and partition | Rich routing rules, priorities, delays |
| Best for | Event streaming, data pipelines, replay, many independent consumers | Task queues, complex routing, per-message workflows |

Kafka has traditionally been a poor fit for "job queue" workloads, where each message is an independent task that should be acknowledged individually and retried on its own. **Queues for Kafka** (KIP-932), introduced as an early-access feature in Kafka 4.0, adds **share groups**, which let multiple consumers read from the same partition with per-record acknowledgement, bringing queue-like behaviour to Kafka.

## When Not to Use Kafka

Kafka is powerful but operationally heavy. It may be the wrong choice when:

- You only need a simple task queue for a small application. A lighter tool like RabbitMQ, Amazon SQS, or a Redis-based queue is easier to run.
- You need request-response communication with immediate replies. Use HTTP or gRPC.
- Your volume is low and you don't need replay or multiple independent consumers.
- You need strict global ordering across all events at high throughput. Kafka only orders within a partition, and a single partition limits throughput.
- You need per-message priorities, delayed delivery, or complex routing rules, which traditional brokers handle natively.
- Your team can't take on the operational load, in which case consider a managed service (Confluent Cloud, Amazon MSK, Aiven) or a Kafka-compatible alternative such as Redpanda.

## Running Kafka Locally

The quickest way to try Kafka is with the official Docker image, which runs a single-node KRaft cluster:

```bash
docker run -d --name kafka -p 9092:9092 apache/kafka:latest
```

Then use the CLI tools that ship inside the container:

```bash
# Create a topic with 3 partitions
docker exec -it kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --create --topic orders --partitions 3 --replication-factor 1

# Describe it: partitions, leaders, replicas, ISR
docker exec -it kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 --describe --topic orders

# Produce records with keys (type key:value, one per line)
docker exec -it kafka /opt/kafka/bin/kafka-console-producer.sh \
  --bootstrap-server localhost:9092 --topic orders \
  --property parse.key=true --property key.separator=:

# Consume from the beginning in a consumer group, showing keys and partitions
docker exec -it kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 --topic orders --group demo \
  --from-beginning --property print.key=true --property print.partition=true

# Check consumer lag for the group
docker exec -it kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 --describe --group demo

# Rewind the group to the start of the topic (the group must be inactive)
docker exec -it kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 --group demo --topic orders \
  --reset-offsets --to-earliest --execute
```

## Best Practices

### Topic and Partition Design

- **Choose keys carefully.** Use a key that groups records needing order (such as `orderId` or `accountId`) and that spreads load evenly. A skewed key, like a single huge customer, creates a "hot" partition.
- **Plan partition counts up front.** Adding partitions later changes which partition a key maps to, which breaks per-key ordering for existing keys. Size for future throughput and consumer parallelism, but don't overdo it: every partition costs memory, file handles, and recovery time.
- **Use sensible naming conventions**, such as `<domain>.<entity>.<event>` (`sales.order.placed`), and disable `auto.create.topics.enable` in production.

### Reliability

- Use `replication.factor=3`, `min.insync.replicas=2`, and `acks=all` for important data.
- Keep idempotence on and configure `transactional.id` when you need exactly-once pipelines.
- Make consumers idempotent, because at-least-once delivery means duplicates will happen eventually.
- Send records that repeatedly fail processing to a **dead-letter topic** instead of blocking the partition or dropping them.

### Schemas and Data

- Use a schema registry with compatibility checks for any topic shared between teams.
- Keep records reasonably small. Kafka's default maximum message size is about 1 MB. For large payloads, store the data in object storage and send a reference.

### Operations and Monitoring

Watch these metrics closely:

- **Consumer lag** per group and partition (Burrow, Kafka UI, or your monitoring stack).
- **Under-replicated partitions**, which should be zero in a healthy cluster.
- **Offline partitions** and **active controller count**.
- Request latency, disk usage, network throughput, and ISR shrink and expand rates.

And secure the cluster with TLS encryption, SASL authentication (SCRAM, OAuth, or mTLS), and ACLs that restrict which clients can read and write each topic.

## Conclusion

Kafka's power comes from a deceptively simple idea: a partitioned, replicated, append-only log. Partitions give it horizontal scale and per-key ordering. Replication with in-sync replicas and `acks=all` gives durability. Consumer groups and offsets let any number of independent applications read the same data at their own pace, and replay it when needed. Sequential I/O, batching, compression, and the OS page cache make it fast.

On top of that foundation sit idempotent producers and transactions for exactly-once processing, KRaft for simpler operations, tiered storage for cheap long-term retention, and an ecosystem of Connect, Streams, and schema registries for building full data platforms. Kafka isn't the right tool for every messaging problem, but when you need a durable, scalable backbone for events flowing between many systems, it remains the default choice for good reason.
