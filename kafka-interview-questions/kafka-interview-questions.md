---
title: Top 100 Apache Kafka Interview Questions with Crisp Answers
date: 2026-10-20
summary: A curated collection of 100 essential Apache Kafka interview questions with short, accurate answers covering architecture, producers, consumers, reliability, KRaft, and production best practices.
tag: Kafka
draft: false
---

## Fundamentals & Architecture

1. **What is Apache Kafka?**  
   A distributed, high-throughput, fault-tolerant event streaming platform that acts as a durable append-only commit log for publishing, storing, and consuming streams of records in real time.

2. **What are the main components of Kafka?**  
   Producers, Consumers, Brokers, Topics, Partitions, and (historically) ZooKeeper / now KRaft Controllers.

3. **What is a Topic?**  
   A logical category or feed name to which records are published. Topics are split into one or more partitions.

4. **What is a Partition?**  
   An ordered, immutable, append-only log of records. It is the unit of parallelism and ordering (order is guaranteed only within a partition).

5. **What is an Offset?**  
   A unique sequential identifier (monotonically increasing) for each record within a partition. Consumers track their position using offsets.

6. **What is a Broker?**  
   A single Kafka server that stores data and serves clients. A cluster consists of multiple brokers.

7. **What is a Producer?**  
   A client application that publishes (writes) records to Kafka topics.

8. **What is a Consumer?**  
   A client application that subscribes to topics and reads (polls) records.

9. **What is a Consumer Group?**  
   A set of consumers that cooperatively consume from one or more topics by dividing the partitions among themselves. Each partition is consumed by exactly one consumer in the group at a time.

10. **How does Kafka differ from traditional message queues (e.g., RabbitMQ)?**  
    Kafka retains messages for a configurable period (not deleted on consumption), supports multiple independent consumer groups, provides high throughput via sequential disk writes, and offers strong ordering within partitions. Traditional queues typically delete messages after consumption and focus more on complex routing.

11. **What is the high-level architecture of a Kafka cluster?**  
    Multiple brokers form a cluster. Topics are partitioned and replicated across brokers. Producers write to partition leaders; consumers read from leaders (or followers in some configurations). Metadata is managed by KRaft controllers.

12. **What is the role of the Controller?**  
    Manages cluster metadata, leader election, partition assignment, and administrative operations. In modern Kafka, controllers form a KRaft quorum.

13. **What is KRaft?**  
    Kafka Raft — Kafka’s built-in consensus protocol that replaces ZooKeeper. Cluster metadata is stored in an internal `__cluster_metadata` topic replicated via Raft.

14. **Why did Kafka move from ZooKeeper to KRaft?**  
    To simplify operations (single system instead of two), enable faster metadata propagation and failover, support larger numbers of partitions, and reduce operational complexity.

15. **What is the `__cluster_metadata` topic?**  
    The internal topic that stores and replicates all cluster metadata (topics, partitions, configurations, ACLs, leadership) under KRaft.

16. **What is a Replica?**  
    A copy of a partition. Each partition has one leader replica and zero or more follower replicas.

17. **What is the Leader of a partition?**  
    The replica that handles all reads and writes for that partition. Followers replicate from the leader.

18. **What is ISR (In-Sync Replicas)?**  
    The set of replicas (including the leader) that are fully caught up with the leader within `replica.lag.time.max.ms`. Only ISR members are eligible for leadership.

19. **What is the High Watermark (HW)?**  
    The offset up to which all ISR members have replicated. Consumers can only read up to the high watermark.

20. **What is Replication Factor?**  
    The total number of copies of a partition across the cluster (e.g., RF=3 means one leader + two followers).

## Producers

21. **How does a producer decide which partition to send a record to?**  
    If a key is provided, it is hashed (default partitioner) so the same key always goes to the same partition (while partition count remains constant). If no key, records are distributed in a sticky or round-robin fashion.

22. **What does the `acks` setting control?**  
    How many acknowledgments the producer requires:  
    - `acks=0`: Fire-and-forget (no guarantee).  
    - `acks=1`: Leader acknowledges after writing locally.  
    - `acks=all` (or `-1`): All current ISR members acknowledge (strongest durability).

23. **What is `min.insync.replicas`?**  
    The minimum number of in-sync replicas required for an `acks=all` write to succeed. Common setting: RF=3 + `min.insync.replicas=2`.

24. **What is an Idempotent Producer?**  
    A producer that prevents duplicates on retries by assigning a Producer ID (PID) and sequence numbers per partition. Enabled with `enable.idempotence=true` (default in recent versions).

25. **What are the requirements for an idempotent producer?**  
    `enable.idempotence=true`, `acks=all`, `retries > 0`, and `max.in.flight.requests.per.connection ≤ 5`.

26. **What is `linger.ms`?**  
    The time the producer waits to accumulate more records into a batch before sending. Higher values improve throughput at the cost of latency.

27. **What is `batch.size`?**  
    Maximum size of a batch of records for a partition. Larger batches improve throughput.

28. **What compression algorithms does Kafka support?**  
    gzip, snappy, lz4, and zstd. Compression is done on the producer side and can be passed through or recompressed by the broker.

29. **What is `max.in.flight.requests.per.connection`?**  
    Maximum number of unacknowledged requests per connection. Must be ≤5 for idempotent producers to preserve ordering.

30. **What happens if a producer send fails?**  
    Depending on configuration, the producer retries (with exponential backoff) up to `retries` times. With idempotence enabled, retries do not create duplicates.

31. **How do Kafka transactions work?**  
    Using a `transactional.id`, the producer can begin/commit/abort transactions that atomically write records and consumer offsets. Consumers with `isolation.level=read_committed` only see committed data.

32. **What is the purpose of `transactional.id`?**  
    Identifies a producer instance for fencing (ensures only one active producer with that ID) and enables exactly-once semantics across restarts.

33. **What is message key used for?**  
    Primarily for partitioning (same key → same partition) and for log compaction (latest value per key is retained).

34. **What is the default maximum message size?**  
    1 MB (`message.max.bytes` on broker, `max.request.size` on producer). Can be increased, but large messages hurt performance.

35. **How does the producer handle metadata?**  
    It caches metadata and refreshes it when needed (e.g., on `NotLeaderOrFollower` or periodically). Metadata is fetched from any broker (or controller).

## Consumers & Consumer Groups

36. **How do consumer groups distribute work?**  
    The group coordinator assigns partitions to consumers in the group. Each partition is assigned to at most one consumer in the group. Assignment strategies include Range, RoundRobin, Sticky, and CooperativeSticky.

37. **What is consumer rebalancing?**  
    The process of reassigning partitions when consumers join/leave the group or when partitions change. Classic protocol is stop-the-world; newer protocol (KIP-848) is incremental and broker-driven.

38. **What is the new consumer rebalance protocol (KIP-848)?**  
    A broker-driven, incremental rebalance protocol (GA in Kafka 4.0). Enabled with `group.protocol=consumer`. Avoids stop-the-world pauses.

39. **What is consumer lag?**  
    The difference between the latest offset in a partition and the offset last committed by the consumer. High lag indicates the consumer is falling behind.

40. **What is `auto.offset.reset`?**  
    Behavior when no committed offset exists: `earliest` (from beginning), `latest` (only new records), or `none` (throw exception).

41. **What is offset commit?**  
    Recording the consumer’s progress. Can be automatic (`enable.auto.commit=true`) or manual (`commitSync` / `commitAsync`).

42. **What is the difference between `commitSync` and `commitAsync`?**  
    `commitSync` blocks until the commit is acknowledged (safer, higher latency). `commitAsync` is non-blocking (better throughput, needs careful error handling).

43. **What is `max.poll.records`?**  
    Maximum number of records returned in a single `poll()` call.

44. **What is `max.poll.interval.ms`?**  
    Maximum time between `poll()` calls. If exceeded, the consumer is considered dead and a rebalance is triggered.

45. **What is `session.timeout.ms` and `heartbeat.interval.ms`?**  
    `session.timeout.ms` is how long the coordinator waits without a heartbeat before removing the consumer. `heartbeat.interval.ms` is how often the consumer sends heartbeats (should be ≤1/3 of session timeout).

46. **What is the difference between consumer groups and share groups?**  
    Consumer groups preserve per-partition ordering and assign partitions exclusively. Share groups (KIP-932) provide queue-like semantics where multiple consumers can process records from the same partition independently (no ordering guarantee).

47. **What is `isolation.level`?**  
    `read_uncommitted` (default) or `read_committed` (only see records from committed transactions).

48. **How does a consumer know where to start reading?**  
    From the last committed offset for its group + topic-partition, or according to `auto.offset.reset` if none exists.

49. **What is the Consumer Coordinator?**  
    A broker that manages a consumer group: handles joins, leaves, heartbeats, and partition assignment.

50. **Can a consumer read from a specific offset?**  
    Yes, by calling `seek()`, `seekToBeginning()`, or `seekToEnd()` on the `KafkaConsumer`.

## Reliability, Delivery Semantics & Consistency

51. **What are the three delivery semantics?**  
    - At-most-once: messages may be lost, never duplicated.  
    - At-least-once: messages never lost, may be duplicated.  
    - Exactly-once: messages neither lost nor duplicated (within Kafka).

52. **How do you achieve at-least-once delivery?**  
    Producer: `acks=all` + retries. Consumer: process message, then commit offset.

53. **How do you achieve at-most-once delivery?**  
    Commit offset before processing (risk of loss on crash). Producer may use `acks=0` or `acks=1`.

54. **How does Kafka provide exactly-once semantics?**  
    Idempotent producer + transactions (atomic write of records and offsets). Kafka Streams uses `exactly_once_v2`. Outside Kafka, external systems need idempotent sinks.

55. **What is the role of `unclean.leader.election.enable`?**  
    If true, an out-of-sync replica can become leader when no ISR is available (risks data loss). Default is false.

56. **What happens when a broker fails?**  
    The controller detects the failure, elects a new leader from the ISR for affected partitions, and updates metadata. Producers and consumers refresh metadata and continue.

57. **What is log compaction?**  
    A retention policy (`cleanup.policy=compact`) that keeps only the latest value for each key. Useful for changelog topics and restoring state.

58. **What are tombstone records?**  
    Records with a null value. In compacted topics, they mark a key for deletion. They are retained for `delete.retention.ms`.

59. **What is the difference between time-based and size-based retention?**  
    Time-based: delete segments older than `retention.ms`. Size-based: delete when log exceeds `retention.bytes`. Both can be combined; compaction is a separate policy.

60. **How does Kafka guarantee ordering?**  
    Strictly within a partition (and only if the producer sends with the same key and `max.in.flight.requests.per.connection` is limited appropriately). No global ordering across partitions.

## Storage, Internals & Performance

61. **How does Kafka achieve high throughput?**  
    Sequential disk writes, zero-copy transfer (`sendfile`), page cache, batching, compression, and partition-level parallelism.

62. **What is zero-copy?**  
    Data is transferred directly from the page cache / file to the network socket without copying into user-space buffers, using OS facilities like `sendfile`.

63. **What is a log segment?**  
    A physical file that holds a portion of a partition’s log. When a segment reaches `log.segment.bytes` or time limit, a new one is rolled.

64. **What is the role of the log cleaner?**  
    Background threads that perform log compaction on topics with `cleanup.policy=compact`.

65. **What is tiered storage?**  
    Ability to move older log segments to remote storage (e.g., S3) while keeping recent data on local disks. Consumers can read from both transparently.

66. **What is rack-aware replica placement?**  
    Using `broker.rack` to place replicas of a partition on different racks/availability zones to survive correlated failures.

67. **What factors affect Kafka performance the most?**  
    Number of partitions, batch size / linger, compression, replication factor, disk type (SSD preferred), network bandwidth, and consumer lag / processing speed.

68. **Why should you not create too many partitions?**  
    Each partition has overhead (file handles, memory for indexes, controller metadata, rebalance time). Too many can degrade performance and increase recovery time.

69. **What is the recommended replication factor for production?**  
    3 (tolerates one broker failure while maintaining durability with `min.insync.replicas=2`).

70. **How does Kafka handle large numbers of partitions?**  
    Modern Kafka (especially with KRaft) supports millions of partitions, but operational limits still exist around open files, memory, and rebalance duration.

## Kafka Ecosystem

71. **What is Kafka Connect?**  
    A framework for reliably streaming data between Kafka and external systems using source and sink connectors. Supports distributed mode, offset management, and fault tolerance.

72. **What is Kafka Streams?**  
    A client library for building stream processing applications that read from Kafka, process, and write back to Kafka. Supports stateful operations, windowing, and exactly-once processing.

73. **What is ksqlDB?**  
    A streaming SQL engine built on Kafka Streams that allows querying and transforming streams using SQL-like syntax.

74. **What is Schema Registry?**  
    A service (commonly Confluent) that stores and versions Avro/Protobuf/JSON schemas and enforces compatibility rules (backward, forward, full).

75. **What is MirrorMaker?**  
    A tool (now MirrorMaker 2) for replicating data between Kafka clusters (geo-replication / disaster recovery).

76. **What is the difference between Kafka Streams and Kafka Connect?**  
    Connect is for moving data in/out of Kafka (integration). Streams is for processing data that already resides in Kafka.

77. **What are the main Kafka APIs?**  
    Producer API, Consumer API, Streams API, Connect API, and Admin API.

78. **What is a Connector in Kafka Connect?**  
    A reusable plugin that defines how to pull from a source system or push to a sink system. Can run in standalone or distributed mode.

79. **What is the difference between source and sink connectors?**  
    Source connectors ingest data into Kafka. Sink connectors export data from Kafka to external systems.

80. **What is exactly-once processing in Kafka Streams?**  
    Achieved with `processing.guarantee=exactly_once_v2`, which uses transactions to atomically write results and offsets.

## Security, Operations & Monitoring

81. **How do you secure a Kafka cluster?**  
    TLS for encryption in transit, SASL (PLAIN, SCRAM, GSSAPI/Kerberos, OAuth) for authentication, and ACLs (or RBAC in managed services) for authorization.

82. **What is an ACL in Kafka?**  
    Access Control List that defines which principals can perform which operations (read, write, describe, etc.) on which resources (topics, groups, clusters).

83. **How do you monitor Kafka?**  
    Key metrics: under-replicated partitions, offline partitions, request latency, consumer lag, throughput (bytes in/out), and controller metrics. Tools: Prometheus + Grafana, Confluent Control Center, or JMX exporters.

84. **What is consumer lag and why is it important?**  
    Lag shows how far behind a consumer is. Persistent high lag indicates a problem (slow processing, insufficient consumers, or upstream issues) and can lead to data loss if retention expires.

85. **How do you troubleshoot high consumer lag?**  
    Check processing time, increase consumer instances (up to partition count), optimize batch sizes, check for rebalances, and examine downstream system performance.

86. **What is a controlled shutdown of a broker?**  
    A graceful shutdown that transfers leadership before exiting, minimizing disruption. Triggered by sending SIGTERM or using the controlled shutdown configuration.

87. **How do you increase the number of partitions of a topic?**  
    Use `kafka-topics.sh --alter --partitions <new-count>`. Note: this breaks key-based ordering for existing keys and cannot be easily reversed.

88. **Can you decrease the number of partitions?**  
    Not safely in place. Best practice is to create a new topic with the desired partition count and migrate data.

89. **What is the Admin Client?**  
    The Kafka Admin API used for managing topics, configurations, ACLs, consumer groups, and other cluster resources programmatically.

90. **What are common producer and consumer exceptions?**  
    `TimeoutException`, `NotLeaderOrFollowerException`, `RecordTooLargeException`, `OffsetOutOfRangeException`, `CommitFailedException`, `WakeupException`.

## Advanced & Scenario-Based

91. **What happens if you have more consumers in a group than partitions?**  
    Extra consumers remain idle. Maximum parallelism equals the number of partitions.

92. **How do you handle poison messages?**  
    Use a dead-letter topic (DLT) pattern: catch processing failures, send the bad record to a separate topic, and continue. Can be implemented with Spring Kafka error handlers or custom logic.

93. **What is a hot partition?**  
    A partition that receives disproportionately more traffic (usually due to a skewed key). Solutions: redesign the key, add salting (if ordering not required), or isolate high-volume keys.

94. **How do you achieve ordering across multiple partitions?**  
    You generally cannot with strong guarantees. Options include single partition (sacrifices parallelism) or external sequencing / total order broadcast (expensive).

95. **What is the difference between `read_committed` and `read_uncommitted`?**  
    `read_committed` consumers only see records from transactions that have been committed (and the last stable offset). `read_uncommitted` can see uncommitted and aborted records.

96. **How does Kafka handle schema evolution?**  
    Via Schema Registry with compatibility modes (BACKWARD, FORWARD, FULL, NONE). Producers and consumers must use compatible schemas.

97. **What is the role of `replica.lag.time.max.ms`?**  
    Maximum time a follower can be behind the leader before being removed from the ISR.

98. **What is Eligible Leader Replicas (ELR)?**  
    A KRaft feature (KIP-966) that tracks replicas that are not in the ISR but are still safe for leadership election when the ISR is empty, reducing unavailability.

99. **How do you design a topic for high throughput and durability?**  
    Choose appropriate partition count (based on throughput and consumer parallelism), RF=3, `min.insync.replicas=2`, `acks=all`, enable idempotence, use compression, and size batches appropriately.

100. **When should you use Kafka versus a traditional database or message queue?**  
    Use Kafka when you need durable, replayable event streams, multiple independent consumers, high throughput, and event-driven architectures. Use a database for transactional CRUD with complex queries; use a traditional queue for simple point-to-point task distribution with rich routing.