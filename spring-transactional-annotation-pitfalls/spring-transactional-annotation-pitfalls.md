---
title: "@Transactional in Spring Boot Explained - Proxies, Propagation, Isolation, Rollback Rules and Common Pitfalls"
date: 2026-11-21
summary: A detailed guide to Spring Boot's @Transactional annotation covering proxy mechanics, propagation, isolation, readOnly, rollback rules, and the pitfalls that break transaction boundaries.
tag: spring-boot, spring, transactional, jpa, hibernate
draft: false
related: n-plus-one-problem-jpa-hibernate,top-10-questions-of-query-annotation-in-spring-jpa,top-10-transactional-annotation-in-spring,database-internals,wal-databases,mvcc-in-databases
---
A **database transaction** groups related reads and writes so they either all become durable together or none of them do. That all-or-nothing rule is the foundation of reliable business operations: debit and credit, order and inventory, payment and receipt. In Spring Boot, the most common way to declare that boundary in application code is **`@Transactional`**.

The annotation looks small on a service method. At runtime it decides when a database connection starts, whether nested work joins that work or starts new work, which exceptions cause rollback, how Hibernate flushes dirty entities, and when side effects such as emails should wait for a successful commit. Teams often learn the happy path first and meet the edge cases later, in production or in a failing integration test.

Spring's transaction support grew out of the need to keep business logic free of explicit begin, commit and rollback calls. Older enterprise stacks pushed developers into verbose APIs or container-specific services. Spring's declarative model uses AOP proxies, a `TransactionInterceptor`, and a `PlatformTransactionManager` such as `JpaTransactionManager`. Spring Boot wires those pieces through auto-configuration once a suitable manager is on the classpath.

This article explains what `@Transactional` does in Spring Boot 3 with Spring Framework 6 and Jakarta Persistence. It covers the proxy model, every major attribute, the difference between Spring's annotation and Jakarta's, then walks through the pitfalls that most often break the intended boundary. The goal is a clear mental model you can apply while reading service code and reviewing pull requests.

## What a Transaction Is

A transaction is a unit of work with four classic properties, often summarized as ACID:

- **Atomicity**: all changes commit, or none do
- **Consistency**: the database moves from one valid state to another according to its constraints
- **Isolation**: concurrent transactions do not see each other's partial work beyond the chosen isolation level
- **Durability**: committed changes survive crashes according to the store's durability settings

Application code rarely implements those properties itself. The database engine and the connection protocol do the hard work. The application must still define the boundary: where the unit begins, what belongs inside it, and when it ends.

Without a boundary, each statement may auto-commit on its own. Related updates can partially succeed. With a boundary that is too wide, locks and connections stay open while the application waits on remote systems. `@Transactional` is Spring's main tool for declaring that boundary in imperative applications.

## What `@Transactional` Does

At a high level, Spring wraps an annotated method as follows:

```
Caller
  |
  v
Spring proxy
  |
  +--> begin or join a transaction
  |
  +--> call the real method
  |
  +--> commit on success
  |     or mark for rollback / roll back on failure
```

The default settings for Spring's `@Transactional` are:

- Propagation: `REQUIRED`
- Isolation: `DEFAULT` (the underlying store's default)
- Read/write, not read-only
- Timeout: the store default, or none
- Rollback on `RuntimeException` and `Error`
- No rollback on checked exceptions unless configured

The annotation is metadata. Without transaction management enabled and without a transaction manager bean, it does nothing useful at runtime. Spring Boot usually enables the infrastructure automatically when it detects a manager. The annotation still depends on calling a Spring-managed bean through its proxy.

You can place `@Transactional` on a class or on individual methods. Method-level settings override class-level settings for that method. Class-level annotations do not automatically apply to methods inherited from a superclass unless those methods are redeclared in a way Spring can see for the subclass.

## How Spring Implements It

### Proxies and the Interceptor

In the default **proxy mode**, Spring creates a bean proxy around the service. External calls go through that proxy. The **`TransactionInterceptor`** starts or joins a transaction before the method runs and completes it afterwards.

```
OrderService bean in the container
        |
        v
   CGLIB / JDK proxy
        |
        +--> TransactionInterceptor
        |
        v
   real OrderService instance
```

Only calls that enter through the proxy are intercepted. A method calling another method on the same object uses `this`, skips the proxy, and skips transaction advice. That is the self-invocation pitfall covered later.

AspectJ mode can weave transaction advice into the class itself so self-calls are intercepted too. Most Spring Boot applications stay on proxy mode because it needs less build and runtime weaving setup.

Proxy type matters:

- **JDK interface proxies** implement the service interfaces. Methods must be public and present on the interface.
- **CGLIB class proxies** subclass the concrete service. Protected and package-visible methods can participate as of Spring Framework 6.0 for class-based proxies. Private and final methods still do not work as advised join points for this proxy model.

Spring Boot often creates class-based proxies depending on configuration and whether interfaces are present. Do not assume interface-only rules if your application uses class proxies, and do not assume class-proxy rules if you force JDK proxies.

### Transaction Managers

A **`PlatformTransactionManager`** begins, commits and rolls back physical transactions. Common choices are:

| Manager | Typical Use |
|---|---|
| `JpaTransactionManager` | JPA / Hibernate with an `EntityManagerFactory` |
| `DataSourceTransactionManager` | JDBC without JPA |
| `JtaTransactionManager` | Distributed or container-managed JTA transactions |

Spring Boot chooses a manager based on the classpath. With Spring Data JPA, that is usually a JPA transaction manager. The manager holds the connection, binds transactional resources to the thread, and coordinates flush and commit.

For JPA, the manager also ties the persistence context to the transaction. Entities loaded inside the transaction stay managed until the transaction ends, unless you clear or detach them. That managed state is why dirty checking can write SQL at flush or commit without an explicit `save` call.

### Auto-Configuration

Spring Boot enables annotation-driven transactions when a transaction manager is present. You rarely need to write `@EnableTransactionManagement` yourself in a typical Boot application. You still need:

- A correctly configured `DataSource` and persistence setup
- Service beans created by the container
- Calls that enter those beans through proxies

If `@Transactional` appears on a component that is not a Spring bean, or on an object created with `new`, there is no proxy and no interceptor.

## Attributes Step by Step

### Propagation

**Propagation** decides how the method interacts with an existing transaction.

| Setting | Behavior | Typical Use |
|---|---|---|
| `REQUIRED` | Join the current transaction, or create one | Default business methods |
| `SUPPORTS` | Join if one exists, otherwise run without a transaction | Optional transactional reads |
| `MANDATORY` | Join if one exists, otherwise fail | Code that must never start its own transaction |
| `REQUIRES_NEW` | Suspend the current one and start a new one | Independent work that must commit even if the outer call fails |
| `NOT_SUPPORTED` | Suspend the current one and run without a transaction | Non-transactional side work |
| `NEVER` | Fail if a transaction already exists | Methods that must stay non-transactional |
| `NESTED` | Nested scope with a savepoint inside the same physical transaction | Partial rollback while keeping the outer transaction |

`REQUIRED` is the right default for most service methods. Nested service calls that also use `REQUIRED` join the same physical transaction. One failure that marks rollback-only affects the whole unit.

`REQUIRES_NEW` is useful for audit writes or progress markers that should survive an outer failure. Example flow:

```
Outer placeOrder (REQUIRED)
  |
  +--> suspend outer
  |
  +--> writeAudit (REQUIRES_NEW) --> commit audit
  |
  +--> resume outer
  |
  +--> outer fails and rolls back business changes
  |
  v
Audit row remains committed
```

That independence has a cost: while the outer transaction is suspended, it may still hold a connection, and the inner work needs another one. Overuse can exhaust the pool.

`NESTED` maps to JDBC savepoints with managers that support them. It is not a second independent database transaction. An inner failure can roll back to the savepoint while the outer transaction continues. Hibernate entity caching does not fully participate in nested semantics, so treat `NESTED` carefully with JPA and prefer it mainly for JDBC-style access patterns that your manager documents as supported.

### Isolation

**Isolation** controls how concurrent transactions see each other's uncommitted or partially committed work. The annotation values are:

- `DEFAULT`
- `READ_UNCOMMITTED`
- `READ_COMMITTED`
- `REPEATABLE_READ`
- `SERIALIZABLE`

Isolation changes apply only with `REQUIRED` or `REQUIRES_NEW`. The actual meaning depends on the database. PostgreSQL and MySQL implement locking and MVCC differently, and the names of anomalies do not map one-to-one across engines.

Raising isolation can reduce anomalies while increasing blocking or serialization failures. Prefer fixing the query plan, unique constraints and application conflict handling first, then choose isolation deliberately for the remaining cases. Blindly setting `SERIALIZABLE` on every service method is rarely a good tradeoff.

### `readOnly`

`readOnly = true` is a hint, not a write firewall.

With Hibernate through Spring's JPA support it typically:

- Sets flush mode toward `MANUAL`, reducing automatic dirty checking and flushes
- Can set the JDBC connection to read-only when connection preparation is enabled

Some databases reject write SQL on a read-only connection. Others do not. Spring Data JPA also marks many repository read methods `readOnly = true` by default. That helps query performance on large object graphs by skipping unnecessary dirty checks.

Do not treat the flag as proof that no write can happen. A modifying query inside a read-only transaction may still attempt to run. Keep write methods on write transactions, and use `readOnly = true` for genuine read paths where the optimization helps.

### Timeout

`timeout` is measured in seconds. It applies to `REQUIRED` and `REQUIRES_NEW`. The manager attempts to bound how long the transaction may run. Exact enforcement still depends on the store and driver.

A timeout is not a substitute for short transactions. If a method calls a remote payment API while holding a database transaction open, a timeout may eventually abort the work, but the design still wastes pool capacity and holds locks longer than needed. Keep remote I/O outside the transaction whenever you can.

### Rollback Rules

By default Spring rolls back on unchecked exceptions and errors, and commits after a checked exception leaves the method. That default surprises teams that use checked business exceptions for failures that must undo work.

```java
@Transactional(rollbackFor = InvoiceException.class)
public void settle(Invoice invoice) throws InvoiceException {
    ledger.post(invoice.lines());
    if (!invoice.isBalanced()) {
        throw new InvoiceException("unbalanced invoice");
    }
}
```

`noRollbackFor` does the opposite for specific types. Spring Framework 6.2 also allows a global default of rolling back for all exceptions through `@EnableTransactionManagement(rollbackOn = ALL_EXCEPTIONS)`. Method-level rules still override for specific types. For Kotlin code, where checked exceptions are not enforced the same way, a consistent all-exceptions rollback policy is often easier to reason about.

## Spring's Annotation vs Jakarta's

Spring supports `jakarta.transaction.Transactional` as a replacement annotation. Prefer Spring's `org.springframework.transaction.annotation.Transactional` in Spring applications unless you specifically need the Jakarta / JTA annotation surface.

Differences to keep in mind:

- Attribute names and enums are not identical.
- Spring's annotation exposes Spring-specific options such as `transactionManager` qualifiers and a familiar Spring rollback style.
- Mixing both annotations on the same type makes the effective metadata harder to reason about.
- Spring documents Jakarta's annotation as supported, but Spring's own annotation remains the natural fit for Boot services.

When reading older samples, also watch for the pre-Jakarta `javax.transaction.Transactional` name. New Spring Boot 3 code should use Jakarta packages.

## Pitfall: Self-Invocation

This is the most common surprise.

```java
@Service
public class OrderService {

    @Transactional
    public void placeOrder(OrderRequest request) {
        createOrder(request); // self-invocation: no proxy, no new advice
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void createOrder(OrderRequest request) {
        // intended to run in a new transaction
    }
}
```

`placeOrder` calls `createOrder` on `this`. The proxy never sees that call, so `REQUIRES_NEW` never starts. If `placeOrder` itself is entered through the proxy, only the outer method's attributes apply to that entry.

Fixes:

- Move the second method to another Spring bean and inject it.
- Inject self through the container carefully if the design requires it.
- Use AspectJ weaving if self-invocation must be advised.

```java
@Service
@RequiredArgsConstructor
public class OrderService {

    private final OrderWriter orderWriter;

    @Transactional
    public void placeOrder(OrderRequest request) {
        orderWriter.createOrder(request); // goes through another bean's proxy
    }
}

@Service
public class OrderWriter {

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void createOrder(OrderRequest request) {
        // now intercepted
    }
}
```

A useful review question is: does this call leave the bean through an injected collaborator, or does it stay on `this`?

## Pitfall: Method Visibility and Final Methods

Historically, Spring documentation steered teams toward public `@Transactional` methods. As of Spring Framework 6.0, **protected** and package-visible methods can be transactional for **class-based proxies** by default. Private methods are still not valid proxy targets for this advice.

Interface-based JDK proxies still require public methods declared on the proxied interface. External calls must enter through the proxy in either case.

If you want the older public-only rule across proxy types, register:

```java
@Bean
TransactionAttributeSource transactionAttributeSource() {
    return new AnnotationTransactionAttributeSource(true); // publicMethodsOnly
}
```

Final methods on a class-based proxy target are also a problem: CGLIB cannot advise a final method. Prefer concrete non-final service methods for transactional boundaries. Making a whole service class final can also prevent class-based proxy creation depending on setup.

## Pitfall: Checked Exceptions Do Not Roll Back by Default

```java
@Transactional
public void transfer(AccountId from, AccountId to, Money amount) throws PaymentException {
    debit(from, amount);
    credit(to, amount);
    if (amount.isSuspicious()) {
        throw new PaymentException("manual review required"); // checked: default is commit
    }
}
```

If `PaymentException` is a checked exception, Spring commits by default after the method exits with that exception. The debit and credit remain. That is correct according to Spring's default rules and wrong for many business failure models.

Fix options:

```java
@Transactional(rollbackFor = PaymentException.class)
public void transfer(AccountId from, AccountId to, Money amount) throws PaymentException {
    // ...
}
```

Or switch the exception hierarchy so business failures that must undo work are unchecked, and document that choice for the team. The important part is intentional policy, not accidental commit after a "failure" exception.

## Pitfall: Swallowed Exceptions and Rollback-Only

Catching an exception inside a transactional method can hide failure from the caller while still marking the transaction rollback-only.

```java
@Transactional
public void importBatch(List<Row> rows) {
    for (Row row : rows) {
        try {
            writer.write(row);
        } catch (RuntimeException ex) {
            log.warn("Skipping row {}", row.id(), ex);
            // transaction may already be marked rollback-only
        }
    }
}
```

If any participating Spring transactional code has marked the transaction rollback-only, a later commit attempt can throw **`UnexpectedRollbackException`**. With `REQUIRED`, an inner scope that marks rollback-only affects the shared physical transaction. The outer caller then discovers at commit time that commit is impossible, even if the outer method itself caught the original exception and continued.

```
Outer REQUIRED
  |
  +--> Inner REQUIRED throws RuntimeException
  |       transaction marked rollback-only
  |
  +--> Outer catches and continues
  |
  v
Commit attempt --> UnexpectedRollbackException
```

Fixes:

- Let the exception propagate when the whole unit must fail.
- Use `REQUIRES_NEW` for truly independent per-row transactions, with clear pool and performance limits.
- Use `NESTED` savepoints only with a manager and resource that support the needed semantics.
- Check transaction status explicitly when building advanced recovery flows.

Silent catch blocks inside transactional services are a frequent source of confusing commit failures later in the call stack.

## Pitfall: `REQUIRES_NEW` Overuse

Every `REQUIRES_NEW` suspension can hold the outer connection while acquiring another. Under load this becomes:

```
Thread A: outer TX holds connection 1, waits for connection 2
Thread B: outer TX holds connection 2, waits for connection 1
```

That is a classic pool stall pattern. Metrics may show idle-looking databases and stuck application threads at the same time.

Use `REQUIRES_NEW` for small, necessary independent units such as audit records or outbox markers that must survive outer rollback. Do not use it as a general way to "make nested calls safer." Prefer clear service boundaries and ordinary `REQUIRED` joining unless independence is a real requirement.

## Pitfall: Long Transactions and Remote Calls

```java
@Transactional
public void confirm(OrderId id) {
    Order order = orders.require(id);
    paymentClient.charge(order); // HTTP call while DB transaction is open
    order.markPaid();
}
```

While the remote call runs, the database transaction may hold a connection and locks. Timeouts, pool exhaustion and lock contention follow. The payment provider's latency becomes your database pool's latency.

Keep transactions around local data access:

```java
public void confirm(OrderId id) {
    Order order = orderQueries.require(id);
    paymentClient.charge(order);
    orderCommands.markPaid(id); // short transactional write
}
```

If you need exactly-once style coordination with external systems, use explicit patterns such as an outbox table committed in the same local transaction, then async dispatch after commit. Do not hold the database transaction open while waiting on the network.

## Pitfall: Private Methods, Interfaces and `@PostConstruct`

Private methods annotated with `@Transactional` are not advised through Spring proxies. The annotation can sit in the source and still do nothing.

Annotating interfaces can work with interface-based and target-class proxies in current Spring versions, but the Spring team recommends annotating concrete classes. Interface annotations are not inherited in the Java language sense, and AspectJ weaving modes can miss them. The result can look fine until a rollback scenario is tested.

`@PostConstruct` runs during bean initialization. The transactional proxy may not be ready for safe use from the same bean's init method. Move startup work to `ApplicationRunner`, `ApplicationReadyEvent`, or another bean that calls the transactional service after the context is up.

## Pitfall: `@Async` and New Threads

`@Async` methods run on another thread. Thread-bound transactions do not travel with that handoff unless you design for it. Starting work with `@Async` inside an open transaction also separates completion from the original commit.

```
@Transactional method
        |
        +--> @Async task scheduled
        |
        v
   transaction commits
        |
        v
   async task later uses another thread / no original TX
```

Publish an event and handle it after commit, or pass explicit identifiers into async workers that open their own transactions. Avoid assuming that a lazy association loaded in the original thread remains usable in the async thread.

## Pitfall: Lazy Loading and Open Session in View

A transaction often keeps the persistence context alive. When the method ends, lazy associations may no longer load. That leads to `LazyInitializationException` unless the needed graph was fetched earlier with a join fetch, an entity graph or a dedicated query.

**Open Session in View** keeps the persistence context open for the web request. That can hide missing fetch plans and push database work into view rendering or JSON serialization. Prefer loading the required graph inside the service transaction, or returning a DTO before leaving that boundary. If OSIV is enabled in your Boot app, treat it as a convenience with a cost, not as a substitute for a clear fetch strategy.

## Pitfall: `readOnly` Misconceptions

Teams sometimes mark every service method `readOnly = true` by default and override for writes. That can be fine as a discipline, but it creates sharp edges:

- A write accidentally left on a read-only method may fail late or behave oddly depending on the database and flush mode.
- Hibernate's `MANUAL` flush mode can delay visibility of earlier dirty state inside the same persistence context.
- Repository methods already marked read-only can interact with a surrounding write transaction in ways that surprise reviewers.

Use `readOnly` for real read paths. For write paths, leave the default read-write setting and keep the method focused on the unit of work that must commit.

## Pitfall: Multiple Transaction Managers

With more than one manager, specify which one to use:

```java
@Transactional("order")
public void createOrder(Order order) { }

@Transactional("inventory")
public void reserveStock(StockReserve reserve) { }
```

The string can be a bean name or qualifier. Unqualified methods fall back to the default manager. Wrong-manager selection can look like "my annotation is ignored" when writes are simply participating in a different resource.

If most methods on a class share one manager, a type-level qualifier can reduce repetition. Still make the active manager obvious in code reviews when more than one database or resource is involved. Cross-manager atomicity needs JTA or an application-level pattern; two independent `@Transactional` methods on two managers are not one ACID unit.

## Events and `@TransactionalEventListener`

`@TransactionalEventListener` binds listener execution to a transaction phase. The default phase is **`AFTER_COMMIT`**.

```java
@Component
public class OrderEventHandlers {

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onCreated(OrderCreatedEvent event) {
        mailer.sendConfirmation(event.orderId());
    }
}
```

If no transaction is active, the listener is skipped unless `fallbackExecution = true`. After-commit listeners are the usual place for side effects that must not run when the business transaction rolls back.

Other phases exist for before commit, after rollback and after completion. Be careful with further data access in completion phases: transactional resources may still look active even though the original transaction will not commit new changes. Prefer publishing domain events from the transactional service, then handling external side effects after commit.

## Testing Pitfalls

Spring tests often annotate test methods or classes with `@Transactional`. The test transaction rolls back at the end by default. That is convenient and dangerous:

- A missing flush may never hit the database.
- Unique constraint failures can remain hidden until production.
- Code that opens `REQUIRES_NEW` participates differently from ordinary callers.
- Assertions on committed rows can pass for the wrong reason because the test transaction still holds uncommitted state.

For persistence assertions, flush and clear when needed, or disable the test transaction for the cases that must observe committed state. Assert SQL and constraints on the actual write path you care about.

Dirty checking adds another surprise: changing a managed entity can generate SQL at flush or commit without an explicit save call. Tests that inspect the persistence context without flushing can miss that write. A green test with `@Transactional` is not proof that production commits behave the same way.

## Dirty Checking Surprises

With JPA, a loaded entity is managed inside the persistence context. Mutating a field can be enough for Hibernate to issue an `UPDATE` at flush time.

```java
@Transactional
public void rename(UserId id, String name) {
    User user = users.findById(id).orElseThrow();
    user.rename(name); // no repository.save required for a managed entity
}
```

That behavior is normal JPA. It becomes a pitfall when developers assume nothing is written because `save` was never called, or when a read-only transaction and flush mode interact with later queries. Be explicit in code reviews about which methods are expected to write through dirty checking.

## Programmatic Transactions with `TransactionTemplate`

When annotation boundaries become awkward, use **`TransactionTemplate`**:

```java
@Service
@RequiredArgsConstructor
public class SettlementService {

    private final TransactionTemplate transactionTemplate;
    private final LedgerRepository ledger;

    public void settle(Settlement settlement) {
        prepare(settlement); // non-transactional setup
        transactionTemplate.executeWithoutResult(status -> {
            ledger.append(settlement.debit());
            ledger.append(settlement.credit());
        });
        notifyAsync(settlement); // outside the transaction
    }
}
```

Programmatic transactions make the boundary visible in code and help when only part of a method should be transactional. They still use the same manager and still need correct exception handling. Mixing heavy annotation use with occasional `TransactionTemplate` blocks is normal in larger codebases; consistency inside a module matters more than purity.

## Step by Step Decision Guide

When adding or reviewing `@Transactional`, walk through these questions:

1. Is this method entered through a Spring proxy from another bean?
2. Should this work join an existing transaction or start its own?
3. Which exceptions must roll back, including checked ones?
4. Does the method call remote systems, and can that I/O move outside the transaction?
5. Is `readOnly` a real read optimization here, or a habit?
6. If there are multiple managers, which resource is this method talking to?
7. Should after-commit listeners handle emails, messages or search indexing?

If any answer is unclear, the annotation is probably papering over a design question rather than documenting a settled boundary.

## Quick Reference

| Topic | Default / Rule of Thumb |
|---|---|
| Propagation | `REQUIRED` |
| Rollback | Unchecked exceptions and errors |
| Checked exceptions | Commit unless `rollbackFor` says otherwise |
| Proxy interception | External calls only in proxy mode |
| Self-invocation | No transaction advice |
| Visibility | Public everywhere; protected/package-private OK for class-based proxies since Spring 6 |
| Private / final methods | Not advised by standard proxies |
| `readOnly` | Hint and flush optimization, not a hard write ban |
| `REQUIRES_NEW` | Independent commit, extra connection cost |
| `NESTED` | Savepoint semantics, manager-dependent |
| Side effects | Prefer `@TransactionalEventListener(AFTER_COMMIT)` |
| Tests | Test rollback can hide flush and constraint issues |
| Alternative | `TransactionTemplate` for visible programmatic boundaries |

## Common Mistakes

- Annotating a private method and expecting proxy advice to run.
- Calling `this.someTransactionalMethod()` and assuming propagation changes apply.
- Catching exceptions inside the transaction and assuming the unit will still commit cleanly.
- Leaving HTTP, message publishing or email inside a wide database transaction.
- Using `readOnly = true` on a method that must write, then chasing odd flush behavior.
- Expecting interface-only annotations to behave the same under every weaving mode.
- Treating a green `@Transactional` test as proof that production commits work.
- Spawning `@Async` work and assuming it shares the original persistence context.
- Using `REQUIRES_NEW` everywhere to avoid thinking about joining transactions.

## Conclusion

`@Transactional` is a declaration of a consistency boundary, implemented by proxies, interceptors and a transaction manager. Its attributes are precise: propagation decides joining or suspending, isolation decides concurrent visibility, rollback rules decide undo conditions, and `readOnly` mainly changes optimization hints.

Most production surprises come from the gap between the annotation and the runtime path. Self-invocation, exception handling, long-held connections, lazy loading and test rollback semantics all sit in that gap. Keep transactional methods focused on data access, make boundaries cross bean proxies deliberately, move remote I/O and notifications outside the database transaction, and verify rollback and commit behavior for the failure modes you care about.

Used with a clear mental model, `@Transactional` stays one of the highest leverage tools in a Spring Boot codebase. Used as a stamp on every method without checking the call path, it becomes a source of silent no-ops and late `UnexpectedRollbackException` failures. The difference is almost always in the proxy, the exception policy and the width of the boundary.
