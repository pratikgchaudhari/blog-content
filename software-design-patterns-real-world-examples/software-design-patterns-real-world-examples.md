---
title: Design Patterns in the Wild - Where You Already Use Them in Java, Spring and Hibernate
date: 2026-10-30
summary: The classic design patterns explained through the JDK, Spring, Hibernate and SLF4J code you already use every day, plus a realistic app scenario for each.
tag: design-patterns, java, spring, hibernate, software-design, object-oriented-design, gof, backend
draft: false
related: top-design-patterns-in-java,solid-principles,javas-prototype-pattern-smart-copypasta-for-new-objects
---

You've been using design patterns for years. You just didn't call them that.

Every time you wrapped a `FileInputStream` in a `BufferedInputStream`, you used a Decorator. Every time you passed a `Comparator` to `sort()`, you used a Strategy. And every time a `@Transactional` method magically rolled back, a Proxy did the work behind your back.

So why do patterns feel so academic when you read about them? I think it's because most explanations start with shapes and animals. `Circle extends Shape`. `Dog implements Animal`. Nobody ships `Dog implements Animal` to production.

This post goes the other way. For each pattern, we'll look at where it already lives in code you use (the JDK, Spring, Hibernate, SLF4J), and then at a realistic place you'd use it yourself: payments, notifications, an order pipeline, a rate limiter. The snippets are short on purpose.

If you want the one-line cheat sheet version, I've got that in my Top Design Patterns in Java post. This one is the long version.

## What a pattern is (and what it isn't)

A design pattern is a named, reusable solution to a problem that keeps coming up in object-oriented code. The name is half the value. Saying "wrap it in a decorator" in a code review saves you three paragraphs of explanation.

The classic list comes from *Design Patterns: Elements of Reusable Object-Oriented Software*, published in 1994 by Erich Gamma, Richard Helm, Ralph Johnson and John Vlissides. They're usually called the Gang of Four, or GoF. The book describes 23 patterns grouped into three families: creational (how objects get created), structural (how objects are put together) and behavioural (how objects talk to each other and share work).

What a pattern isn't: a library you import, a rule you must follow, or a goal in itself. A pattern is a trade-off. It usually adds an interface or a class or two in exchange for flexibility somewhere specific. If you don't need flexibility there, you're paying for nothing.

Keep that in mind. We'll come back to it at the end.

## Creational patterns

These are about creating objects without hard-wiring exactly which class gets created, or how.

### Singleton

One instance of a class, with a single global way to get at it.

The JDK's classic example is `Runtime`. There's exactly one per JVM, and you get it through `Runtime.getRuntime()`. You can't `new` one.

```java
Runtime rt = Runtime.getRuntime();
System.out.println(rt.availableProcessors() + " cores, " + rt.maxMemory() + " bytes max heap");
```

If you need to write one yourself, Joshua Bloch's *Effective Java* recommends a single-element enum. It's thread-safe, it survives serialisation, and reflection can't sneak a second instance in:

```java
public enum AppClock {
    INSTANCE;

    public Instant now() {
        return Instant.now();
    }
}
```

Now the uncomfortable part. Singleton is the most overused pattern on the list, and in a lot of codebases it's a smell. A static singleton is global state with a fancy name. Any class can reach it, so you can't see dependencies from a constructor, and you can't swap it in a test without hacks. That `AppClock` above? The moment you need a test where "now" is a fixed date, you'll regret it.

What most of us actually want is "one instance per application", and that's what Spring gives you for free. Spring beans are singleton-scoped by default, meaning one instance per container, but they're injected through constructors like any other dependency. You get the single instance without the global access. For the clock case, inject a `java.time.Clock` and pass `Clock.fixed(...)` in tests.

### Factory Method

Factory Method lets a class defer the decision of *which* concrete class to create, usually to a subclass or to a method that picks one for you.

You call factory methods all the time. `Calendar.getInstance()` hands back a calendar for your locale (often a `GregorianCalendar`, but you don't have to know). `NumberFormat.getCurrencyInstance(locale)` does the same for formatters. And `Collection.iterator()` is the textbook GoF version: every collection subclass overrides it to return its own iterator implementation.

Here's a realistic one. QuickPay (a made-up payments app) supports UPI, cards and net banking. The checkout code shouldn't care which processor class handles a payment:

```java
public interface PaymentProcessor {
    PaymentResult pay(Payment payment);
}

public final class PaymentProcessors {

    public static PaymentProcessor forMethod(PaymentMethod method) {
        return switch (method) {
            case UPI -> new UpiProcessor();
            case CARD -> new CardProcessor();
            case NET_BANKING -> new NetBankingProcessor();
        };
    }
}
```

Strictly speaking, that's a static factory method rather than the subclass-based GoF version, but in day-to-day Java this is what people mean. In Spring, you'd usually let the container do it: inject a `Map<String, PaymentProcessor>` and Spring fills it with every processor bean keyed by bean name.

### Abstract Factory

Abstract Factory creates *families* of related objects that are meant to work together, without the caller knowing the concrete classes.

JDBC is the best real-world example I know. A `Connection` is a factory for `Statement`, `PreparedStatement` and `CallableStatement` objects. If the connection came from the PostgreSQL driver, every object it creates is a PostgreSQL implementation. Swap the driver, and the whole family changes. Your code only ever sees the interfaces.

```java
try (Connection conn = dataSource.getConnection();
     PreparedStatement ps = conn.prepareStatement("select * from orders where id = ?")) {
    ps.setLong(1, orderId);
    // ps is a driver-specific class you never name
}
```

`DocumentBuilderFactory.newInstance()` in the XML APIs works the same way: it returns some parser implementation, and that implementation creates matching builders.

When would you write one? Picture a notification system that has to support two providers, say an in-house SMTP setup and a third-party service, where each provider has its own email sender, SMS sender and template renderer that only work with each other. One `NotificationProviderFactory` interface with `emailSender()`, `smsSender()` and `templateRenderer()` keeps you from ever mixing provider A's sender with provider B's templates. Honestly, that's rarer than it sounds. If you only have one product per family, you want Factory Method.

### Builder

Builder constructs a complex object step by step, so you don't end up with a constructor that takes eleven arguments, four of them `null`.

The JDK's modern HTTP client is a lovely example:

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(2))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();

HttpRequest request = HttpRequest.newBuilder(URI.create("https://api.example.com/orders"))
        .header("Accept", "application/json")
        .timeout(Duration.ofSeconds(5))
        .GET()
        .build();
```

`StringBuilder` is the one everyone mentions, and it's builder-ish: you build up a string in steps and call `toString()` at the end. Spring is full of them too: `UriComponentsBuilder`, `RestClient.builder()`, `ResponseEntity.ok().header(...).body(...)`.

You'll rarely hand-write a builder these days. Lombok's `@Builder` generates one for you:

```java
@Builder
public record OrderRequest(String customerId, List<LineItem> items,
                           String couponCode, DeliverySlot slot, boolean contactless) {}

var req = OrderRequest.builder()
        .customerId("c-42")
        .items(cart.items())
        .contactless(true)
        .build();
```

Use a builder when an object has several optional parts. If it has two required fields and nothing else, a constructor is fine. Don't let anyone talk you into a builder for a `Point`.

### Prototype

Prototype creates new objects by copying an existing one instead of building from scratch.

In the JDK, that's `Object.clone()` and the `Cloneable` interface. It works, but it's widely considered broken (shallow copies by default, a checked exception, and a marker interface that doesn't even declare `clone()`). Copy constructors like `new ArrayList<>(existing)` are the friendlier version of the same idea.

A realistic use: an e-commerce app with a "default" `OrderConfig` (tax rules, delivery fees, feature flags) that's expensive to assemble. Each new order starts from a copy of it and tweaks a field or two. With records, `withX` methods give you this for free.

One naming trap. Spring's `prototype` bean scope means "give me a new instance every time I ask". It's related in spirit but doesn't copy anything. I've written more about the cloning side in my post on Java's Prototype pattern ("Smart Copypasta for New Objects").

## Structural patterns

These are about putting objects together so they fit, add behaviour, or hide complexity.

### Adapter

Adapter makes one interface look like another so two things that weren't designed to work together can.

`InputStreamReader` is the classic. You have bytes (`InputStream`), you want characters (`Reader`), and the adapter sits in between, handling the charset. `Arrays.asList(array)` adapts an array into a `List` view. In Spring MVC, `HandlerAdapter` is what lets the `DispatcherServlet` call very different kinds of handlers (annotated controllers, plain `HttpRequestHandler`s) through one interface.

SLF4J uses adapters too. Your code logs through the SLF4J API, and a binding such as `slf4j-jdk14` adapts those calls to `java.util.logging`.

The scenario where you'll write one yourself: payment gateways. Your app has its own `PaymentGateway` interface. The vendor SDK has its own idea of what a payment looks like. Don't let the vendor's types leak all over your codebase:

```java
public class AcmePayAdapter implements PaymentGateway {

    private final AcmePayClient sdk; // vendor's client, vendor's types

    public AcmePayAdapter(AcmePayClient sdk) {
        this.sdk = sdk;
    }

    @Override
    public PaymentResult charge(Money amount, String customerId) {
        AcmeChargeResponse r = sdk.createCharge(amount.paise(), "INR", customerId);
        return r.isSuccess() ? PaymentResult.ok(r.getTxnRef()) : PaymentResult.failed(r.getErrorCode());
    }
}
```

When you switch vendors (and you will), you write one new adapter instead of touching every service.

### Decorator

Decorator wraps an object to add behaviour, while keeping the same interface. You can stack wrappers.

Java I/O is basically one giant decorator showcase:

```java
try (var in = new DataInputStream(
        new BufferedInputStream(
            new FileInputStream("events.bin")))) {
    int version = in.readInt();
}
```

`FileInputStream` reads bytes, `BufferedInputStream` adds buffering, `DataInputStream` adds `readInt()` and friends. Each one is an `InputStream` that wraps another `InputStream`.

`Collections.unmodifiableList(list)` and `Collections.synchronizedList(list)` are decorators too. The wrapper has the same `List` interface but either throws on writes or adds locking. In the servlet world, `HttpServletRequestWrapper` exists precisely so you can decorate a request (say, to cache the body so it can be read twice).

App scenario: a notification sender you want to add retries and metrics to, without touching the original class:

```java
public class RetryingSender implements NotificationSender {

    private final NotificationSender delegate;

    public RetryingSender(NotificationSender delegate) {
        this.delegate = delegate;
    }

    @Override
    public void send(Notification n) {
        for (int attempt = 1; ; attempt++) {
            try {
                delegate.send(n);
                return;
            } catch (TransientSendException e) {
                if (attempt == 3) throw e; // give up after three tries
            }
        }
    }
}

NotificationSender sender = new MeteredSender(new RetryingSender(new SmsSender(client)));
```

### Proxy

Proxy also wraps an object behind the same interface, but its job is to *control access* to it: add security, transactions, laziness, or a remote call. Structurally it looks a lot like Decorator. The difference is intent.

This is the pattern doing the most invisible work in a Spring app. When you put `@Transactional` on a method, Spring doesn't change your class. It creates a proxy around your bean (a JDK dynamic proxy if you're injecting an interface, or a CGLIB subclass otherwise). Calls go through the proxy, which opens a transaction, calls your real method, and commits or rolls back. `@Cacheable`, `@Async` and Spring Security's `@PreAuthorize` work the same way.

That also explains the most famous Spring gotcha:

```java
@Service
public class OrderService {

    public void placeAll(List<Order> orders) {
        orders.forEach(this::place); // "this" is the real object, not the proxy
    }

    @Transactional
    public void place(Order order) { /* ... */ }
}
```

Calling `place()` from inside the same class skips the proxy, so there's no transaction. Once you know it's a proxy, the "bug" is obvious.

Hibernate does the same thing for lazy loading. A `@ManyToOne(fetch = FetchType.LAZY)` association, or `entityManager.getReference(...)`, gives you a proxy object that only hits the database when you touch a field. Touch it after the session has closed, and you get the beloved `LazyInitializationException`.

If you want to build one yourself, `java.lang.reflect.Proxy` lets you create one at runtime for any interface.

### Facade

Facade puts a simple front on a complicated subsystem.

The clue's in the name with SLF4J: the Simple Logging Facade for Java. You call `log.info(...)` and don't care whether Logback, Log4j 2 or `java.util.logging` is doing the actual work.

Spring's `JdbcTemplate` is a facade over raw JDBC. Compare getting a connection, preparing a statement, looping over a `ResultSet`, mapping rows, handling `SQLException` and closing everything in the right order, with this:

```java
List<Order> orders = jdbc.query(
        "select id, status, total from orders where customer_id = ?",
        (rs, i) -> new Order(rs.getLong("id"), rs.getString("status"), rs.getBigDecimal("total")),
        customerId);
```

In your own app, a facade is often just a well-named service. A `CheckoutService.checkout(cart)` that quietly talks to inventory, pricing, payments and notifications is a facade, and that's a good thing. The controller shouldn't know about four subsystems.

### Composite

Composite lets you treat a single object and a group of objects the same way, usually as a tree.

In AWT, a `Container` is itself a `Component` and holds other `Component`s, so a panel full of buttons can be laid out and painted like a single button. Spring's `CompositeCacheManager` combines several cache managers behind the one `CacheManager` interface.

A neat app use is pricing rules. A discount can be a single rule or a bundle of rules, and the checkout code shouldn't care which:

```java
public interface DiscountRule {
    Money apply(Cart cart, Money price);
}

public record AllOf(List<DiscountRule> rules) implements DiscountRule {
    public Money apply(Cart cart, Money price) {
        for (DiscountRule r : rules) price = r.apply(cart, price);
        return price;
    }
}
```

### Bridge and Flyweight, briefly

Bridge separates an abstraction from its implementation so they can vary independently. JDBC is often cited here too: the JDBC API is the abstraction your code uses, and each vendor's driver is an implementation, and the two evolve separately. SLF4J's API and its bindings follow the same split. You'll rarely design a Bridge from scratch, but it helps to recognise one.

Flyweight shares small, immutable objects instead of creating new ones. `Integer.valueOf()` returns cached instances for values from -128 to 127, which is exactly why `==` on two `Integer`s "works" for small numbers and then mysteriously stops working at 128. String literals and `String.intern()` share instances from the string pool for the same reason. In your own code, think of a map of currency or country objects you look up instead of creating per request.

## Behavioural patterns

These are about how objects share work and pass messages around.

### Strategy

Strategy puts each version of an algorithm behind a common interface so you can swap them at runtime.

`Comparator` is the strategy you use every week:

```java
orders.sort(Comparator.comparing(Order::total).reversed()
                      .thenComparing(Order::createdAt));
```

A less famous but very real one: `ThreadPoolExecutor` takes a `RejectedExecutionHandler` that decides what happens when the queue is full. The JDK ships four of them: `AbortPolicy` (throw, the default), `CallerRunsPolicy` (run it on the caller's thread), `DiscardPolicy` and `DiscardOldestPolicy`. Same executor, different behaviour under load, chosen by a strategy object.

App scenario: a rate limiter. You might use a token bucket for the public API and a fixed window for internal admin calls:

```java
public interface RateLimitStrategy {
    boolean tryAcquire(String clientId);
}

public class RateLimiter {
    private final RateLimitStrategy strategy;

    public RateLimiter(RateLimitStrategy strategy) {
        this.strategy = strategy;
    }

    public void check(String clientId) {
        if (!strategy.tryAcquire(clientId)) throw new TooManyRequestsException(clientId);
    }
}
```

If the strategy is a single method, it's already a functional interface. A lambda is often all the "strategy class" you need.

### Observer

Observer lets one object announce that something happened, and any number of other objects react, without the announcer knowing who's listening.

The JDK used to ship `java.util.Observer` and `Observable`. Both were deprecated in Java 9, because they were clunky and not very type-safe. `java.beans.PropertyChangeListener` is still around and widely used in desktop code.

In Spring, Observer is built in. You publish an event, and any bean with an `@EventListener` method for that type gets called:

```java
public record OrderPlaced(long orderId, String customerId) {}

@Service
class OrderService {
    private final ApplicationEventPublisher events;

    OrderService(ApplicationEventPublisher events) { this.events = events; }

    @Transactional
    public void place(Order order) {
        // save the order ...
        events.publishEvent(new OrderPlaced(order.id(), order.customerId()));
    }
}

@Component
class SendConfirmationEmail {
    @TransactionalEventListener // runs after the transaction commits
    void on(OrderPlaced e) { /* send the email */ }
}
```

The order service doesn't know emails exist. Tomorrow you add a loyalty-points listener and the order service doesn't change. That's the whole point.

Two warnings. By default these listeners run synchronously on the same thread, so a slow listener slows down `place()`. And `@TransactionalEventListener` is there for a reason: you don't want to email someone about an order that then rolled back.

### Template Method

Template Method defines the skeleton of an algorithm in a base class and lets subclasses fill in specific steps.

`HttpServlet` is the classic. Its `service()` method looks at the HTTP verb and calls `doGet()`, `doPost()` and so on, which you override. `AbstractList` is another: implement `get()` and `size()`, and you get `iterator()`, `indexOf()`, `contains()` and the rest for free. And `ThreadPoolExecutor` has protected hook methods, `beforeExecute()` and `afterExecute()`, that you can override to add logging or metrics around every task.

Spring's `JdbcTemplate` gets its name from this pattern, though it uses callbacks (like the `RowMapper` lambda above) instead of subclassing. The fixed skeleton (get a connection, run the statement, translate exceptions, close everything) lives in Spring, and you plug in just the varying part.

App scenario: report exports. Every export loads data, formats it, and uploads the file. Only the format differs:

```java
public abstract class ReportExporter {

    public final void export(ReportRequest req) {   // the fixed skeleton
        List<Row> rows = loadRows(req);
        byte[] file = format(rows);                 // the step that varies
        storage.upload(req.fileName(extension()), file);
    }

    protected abstract byte[] format(List<Row> rows);
    protected abstract String extension();
}
```

Making `export()` `final` is the important bit. Subclasses get to change the steps, not the order.

### Chain of Responsibility

Chain of Responsibility passes a request along a chain of handlers. Each handler either deals with it, passes it on, or stops it.

Servlet filters are the textbook example. Each `Filter` does its bit and calls `chain.doFilter(request, response)` to hand over to the next one. Don't call it, and the request stops there:

```java
public class ApiKeyFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        if (((HttpServletRequest) req).getHeader("X-Api-Key") == null) {
            ((HttpServletResponse) res).sendError(401);
            return; // chain stops here
        }
        chain.doFilter(req, res);
    }
}
```

Spring Security is built as a long chain of these filters. Spring MVC's `HandlerInterceptor` follows the same idea one level up: if `preHandle()` returns `false`, the request never reaches your controller.

App scenario: an order pipeline. Validation, fraud check, stock reservation, pricing. Each step is a handler, and any of them can reject the order. Adding a new check means adding a handler, not editing a 300-line method.

### Command

Command turns a request into an object, so you can queue it, log it, retry it, or undo it.

Every time you submit a `Runnable` or `Callable` to an `ExecutorService`, you're using Command. The task is a little object that says "do this", and the executor decides when and on which thread:

```java
ExecutorService pool = Executors.newFixedThreadPool(4);
Future<Invoice> f = pool.submit(() -> invoiceService.generate(orderId));
```

(Side note: `Executors.newFixedThreadPool()` is itself a static factory method hiding a `ThreadPoolExecutor`. Patterns love company.)

App scenario: admin actions in a back office. If "refund order", "cancel order" and "change delivery address" are each a command object with `execute()` (and maybe `undo()`), you get an audit log, a retry queue, and a "who did what" history almost for free.

### State

State lets an object change its behaviour when its internal state changes, by moving the state-specific logic into separate state objects instead of `if (status == ...)` checks everywhere.

The JDK doesn't have a famous public example I'd point you at, so let's go straight to the app. An order moves through `PLACED`, `PAID`, `SHIPPED`, `DELIVERED` or `CANCELLED`. Cancelling a placed order is fine. Cancelling a delivered one isn't. Modern Java makes this tidy with a sealed interface:

```java
public sealed interface OrderState permits Placed, Paid, Shipped, Delivered, Cancelled {
    default OrderState pay()    { throw new IllegalStateException("Can't pay in " + this); }
    default OrderState ship()   { throw new IllegalStateException("Can't ship in " + this); }
    default OrderState cancel() { throw new IllegalStateException("Can't cancel in " + this); }
}

public record Placed() implements OrderState {
    public OrderState pay()    { return new Paid(); }
    public OrderState cancel() { return new Cancelled(); }
}

public record Paid() implements OrderState {
    public OrderState ship()   { return new Shipped(); }
    public OrderState cancel() { return new Cancelled(); } // refund happens elsewhere
}
// Shipped, Delivered and Cancelled follow the same idea
```

Each state only allows the transitions that make sense, and the compiler knows the full list. For really complex workflows, the Spring Statemachine project exists, but I'd try plain code first.

### Iterator

Iterator gives you a way to walk through a collection without knowing how it's stored.

You use it every time you write a for-each loop. Anything that implements `Iterable` hands out a `java.util.Iterator`, and the compiler turns `for (Order o : orders)` into `hasNext()`/`next()` calls. `Spliterator` is its parallel-friendly cousin that powers streams.

Where you'd write one yourself: paging through a big API or table. An `Iterable<Order>` that fetches 500 rows at a time behind the scenes lets callers write a simple loop without ever thinking about page tokens.

### Visitor and Mediator, briefly

Visitor lets you add new operations over a set of types without changing those types. The JDK's `FileVisitor`, used with `Files.walkFileTree()`, is a real one: you implement `visitFile()`, `preVisitDirectory()` and friends, and the JDK walks the tree calling you. The annotation-processing API (`ElementVisitor`) is another. As we'll see in a minute, sealed types and pattern-matching `switch` have made hand-written visitors much less necessary.

Mediator puts the coordination between many objects in one place, so they don't all talk to each other directly. Spring MVC's `DispatcherServlet` behaves a lot like one: it coordinates handler mappings, handler adapters, view resolvers and exception resolvers, none of which know about each other. In app code, a checkout coordinator, or an in-process event bus, plays the same role. Just watch that your mediator doesn't quietly turn into a god class.

## How modern Java shrinks some of this

A lot of the GoF book was written around the limits of C++ and Smalltalk in the early 90s. Java has picked up features since then that make some patterns almost disappear.

Lambdas killed most Strategy and Command classes. Why write `ByTotalDescendingComparator implements Comparator<Order>` when `Comparator.comparing(Order::total).reversed()` does it in one line? Same for `Runnable` tasks and simple listeners. If an interface has one method, a lambda is usually enough.

`Supplier<T>` is a factory. If all your factory does is create one kind of thing, pass a `Supplier` and move on.

Records take a lot of the pain out of value objects and immutable configs. With compact constructors for validation, you often don't need a builder at all for small objects, and `with`-style copy methods cover the Prototype use case.

Sealed interfaces plus pattern-matching `switch` (Java 21) are the big one. They replace most hand-written Visitors:

```java
sealed interface Payment permits Upi, Card, NetBanking {}
record Upi(String vpa) implements Payment {}
record Card(String last4, String network) implements Payment {}
record NetBanking(String bankCode) implements Payment {}

static Money fee(Payment p, Money amount) {
    return switch (p) {
        case Upi u -> Money.ZERO;
        case Card c when c.network().equals("AMEX") -> amount.percent(3);
        case Card c -> amount.percent(2);
        case NetBanking n -> Money.of(10);
    };
}
```

Add a new payment type to the `permits` list and every `switch` like this one stops compiling until you handle it. That's exactly the safety Visitor was invented to give you, without the `accept()`/`visit()` ping-pong.

And enums cover Singleton and simple State machines nicely, as we saw earlier.

None of this makes the patterns obsolete. The idea behind Strategy is still there in that lambda. You just don't need a class hierarchy to express it anymore.

## Patterns people overuse

Singleton, as we've covered. If it holds state, it's a global variable. If it doesn't, it probably didn't need to be a singleton.

Factories for things that never vary. A `UserServiceFactory` that only ever returns `new UserServiceImpl()` is just ceremony. So is the habit of creating an interface for every class "in case we need another implementation". You can extract an interface when the second implementation actually shows up. Your IDE will do it in two seconds.

Builders for tiny objects. Three fields and no optional ones? Use a constructor, or a record.

Deep Decorator and Proxy stacks. They're great until someone has to debug a stack trace that's 140 frames of wrappers. Spring has a class called `AbstractSingletonProxyFactoryBean`, and I'm still not sure if that name is a joke or a warning.

Observer for everything. Events are lovely for decoupling, but a business flow spread over eight listeners is very hard to follow. If step B always has to happen after step A, a plain method call is easier to read than an event.

## A few anti-patterns worth naming

An anti-pattern is a common solution that looks reasonable and causes more trouble than it solves. A few you'll meet:

The God object: one class (often called `Manager`, `Helper` or `Utils`) that knows and does everything. It's usually a sign that responsibilities were never split, which is the S in SOLID.

The golden hammer: you learned a pattern, and now every problem looks like it needs one. Adding patterns to make the code "enterprise-ready" is how you get five files for one `if` statement.

Service locator: instead of injecting dependencies, classes reach out and grab them from a global registry (`ServiceLocator.get(PaymentGateway.class)`). It hides dependencies just like a static singleton does. Constructor injection is almost always better.

Copy-paste "patterns": the same four-step block repeated in twelve services with tiny differences. That's usually a Template Method or a Strategy asking to be born.

## Which pattern for which problem?

| If your problem is... | Reach for | You've seen it in |
|---|---|---|
| Exactly one shared instance | Singleton (or a Spring singleton bean) | `Runtime.getRuntime()` |
| Choosing which class to create | Factory Method | `Calendar.getInstance()`, `Collection.iterator()` |
| Creating families that must match | Abstract Factory | JDBC `Connection` creating statements |
| Objects with many optional parts | Builder | `HttpRequest.newBuilder()`, Lombok `@Builder` |
| Cheap copies of a configured object | Prototype | Copy constructors, `clone()` |
| A third-party API that doesn't fit yours | Adapter | `InputStreamReader`, SLF4J bindings |
| Adding behaviour by wrapping | Decorator | `BufferedInputStream`, `Collections.unmodifiableList` |
| Controlling access, laziness, transactions | Proxy | Spring AOP, Hibernate lazy loading |
| Hiding a messy subsystem | Facade | SLF4J, `JdbcTemplate` |
| Treating one and many the same way | Composite | AWT `Container`, `CompositeCacheManager` |
| Sharing many small immutable objects | Flyweight | `Integer.valueOf()`, the string pool |
| Swappable algorithms | Strategy | `Comparator`, `RejectedExecutionHandler` |
| Reacting to events without coupling | Observer | Spring `@EventListener` |
| Fixed steps, one part varies | Template Method | `HttpServlet`, `AbstractList`, `JdbcTemplate` |
| A pipeline of checks that can stop early | Chain of Responsibility | Servlet filters, `HandlerInterceptor` |
| Queuing, retrying or undoing actions | Command | `Runnable` and `Callable` in executors |
| Behaviour that depends on a lifecycle | State | Order status as a sealed interface |
| Walking a collection without knowing its storage | Iterator | `java.util.Iterator`, for-each |
| New operations over a fixed set of types | Visitor (or sealed types plus `switch`) | `FileVisitor` |
| Lots of objects coordinating | Mediator | `DispatcherServlet` |

## The bit I'd want you to remember

Patterns are a vocabulary first and a toolbox second. The real win is being able to look at `BufferedInputStream`, a servlet filter or a `@Transactional` method and immediately know what's going on underneath.

When you write your own code, start with the simplest thing that works. When you notice the same kind of change hurting you for the second or third time (a new payment method, a new check in the pipeline, a new notification channel), that's when a pattern earns its keep. Not before.
