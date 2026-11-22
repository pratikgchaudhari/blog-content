---
title: "@Bean vs @Component in Spring Explained - Component Scanning, Java Configuration and When to Use Each"
date: 2026-11-21
summary: A practical guide to @Bean and @Component in Spring Boot covering scanning, stereotypes, full vs lite configuration mode, naming, scopes and decision rules.
tag: spring, spring-boot, bean, component, dependency-injection
draft: false
related: top-10-spring-boot-annotations,bean-scopes-in-spring,top-10-spring-configuration-questions,controller-vs-rest-controller-in-spring-boot,top-100-spring-boot-interview-questions
---

Spring's **IoC container** creates objects, wires their dependencies, and manages their lifecycle. Those managed objects are **beans**. Early Spring applications described beans mostly in XML `<bean>` elements. Spring 2.5 added annotation-driven components and **component scanning**. Spring 3.0 made **Java configuration** a first-class path with `@Configuration` and `@Bean`. Spring Boot builds on that model so most applications declare beans with annotations instead of XML.

```
XML <bean> definitions
        |
        v
Spring 2.5: @Component + component scanning
        |
        v
Spring 3.0: @Configuration + @Bean Java config
        |
        v
Spring Boot: auto-config @Bean methods + app stereotypes
```

XML did not disappear overnight. Legacy files can still load through `@ImportResource`, and beans from XML, scanning, and `@Bean` methods share one factory. Name clashes across those sources are still clashes. For new Boot code, stereotypes and Java config cover nearly every case.

Two annotations sit at the center of that story: **`@Component`** and **`@Bean`**. Both register beans with the container. They do it in different places, with different levels of control, and with different rules for third-party classes and inter-bean calls. Mixing them without a clear rule is a common source of duplicate beans, unexpected new instances, and startup failures when overriding is disabled.

This article explains how each annotation works in Spring Boot 3 with Spring Framework 6, how full and lite configuration modes differ, and when to choose one over the other.

## What the Container Needs

A Spring `ApplicationContext` does not discover every Java class on the classpath by magic. It needs **bean definitions**: metadata that says which type to create, what to name it, how to construct it, and what its scope and lifecycle callbacks are.

There are several ways to supply those definitions:

- XML `<bean>` elements
- Component scanning of stereotype-annotated classes
- `@Bean` factory methods in configuration classes
- Programmatic registration through the bean factory APIs

In a typical Boot app, scanning and `@Bean` methods do almost all of the work. Programmatic registration still matters for frameworks, tests, and dynamic modules. `@Component` and `@Bean` are conveniences on top of the same bean definition model.

```
Classpath classes
        |
        +--> @Component / stereotypes ----> scanned bean definitions
        |
        +--> @Configuration + @Bean ------> factory-method bean definitions
        |
        v
ApplicationContext / BeanFactory
        |
        v
Managed bean instances
```

`@Component` answers: "this class is a Spring bean; please construct it."
`@Bean` answers: "run this method; the return value is a Spring bean."

Both paths end in the same place. The difference is who owns the construction recipe and whether you can annotate the class that becomes the bean.

You can also register beans by hand when annotations get in the way:

```java
AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
context.register(AppConfig.class);
context.registerBean(Clock.class, Clock::systemUTC);
context.refresh();
```

That API is the same model underneath scanning and `@Bean` methods. Reach for it in tests, bootstraps, or framework code, then return to annotations for everyday application types.

IoC is the broad idea: the container owns object creation and wiring. **Dependency injection** is the main technique Spring uses to supply collaborators. With `@Component`, injection usually happens through the constructor of the scanned class. With `@Bean`, injection happens through factory method parameters, or through calls that full-mode configuration redirects to the container. Field injection still works, but constructor and factory-method parameters make required dependencies obvious and simplify tests.

## `@Component` and the Stereotype Family

`@Component` is a class-level stereotype. When component scanning finds a class annotated with it, Spring registers a bean definition for that class and later creates an instance, usually by constructor injection.

Spring ships specialized stereotypes that are meta-annotated with `@Component`:

| Annotation | Typical Layer | Extra Behavior |
|---|---|---|
| `@Component` | Generic managed type | Baseline stereotype |
| `@Service` | Business logic | Documents intent; no special runtime magic by itself |
| `@Repository` | Persistence access | Marks eligibility for persistence **exception translation** |
| `@Controller` | MVC controller | Eligible for request mapping |
| `@RestController` | REST controller | `@Controller` + `@ResponseBody` |
| `@Configuration` | Configuration source | Source of `@Bean` methods; full mode by default |

```java
@Service
public class OrderService {

    private final OrderRepository orders;

    public OrderService(OrderRepository orders) {
        this.orders = orders;
    }

    public Order place(OrderRequest request) {
        return orders.save(Order.from(request));
    }
}
```

`@Repository` is worth a closer look. Beyond documentation, Spring can apply a persistence exception translation post-processor so vendor-specific data access exceptions become Spring's `DataAccessException` hierarchy when a translator is present. In a JDBC or JPA setup with that infrastructure present, a low-level SQL failure can surface as a Spring data-access exception. That is one reason teams keep `@Repository` on persistence adapters even though `@Component` would also make the class a bean. Spring Data repository interfaces are usually enabled through `@EnableJpaRepositories` (and friends) rather than by putting `@Repository` on the interface yourself.

`@Service` today is mainly about intent and readability. It does not turn on transactions by itself. You still need `@Transactional` and a transaction manager for that.

`@Configuration` is also a `@Component`. That is why configuration classes are found by scanning (or imported) like other components, then processed as bean-definition sources.

A readable package layout often mirrors these stereotypes: controllers, services, and repository adapters under feature packages, with `@Configuration` classes beside clients and property types. Keep entities, DTOs, and value types free of stereotypes unless they truly need to be beans. Not every class in a Spring project should be a bean.

## Component Scanning and `@SpringBootApplication`

`@SpringBootApplication` is a composed annotation. Among other things it turns on **`@ComponentScan`** for the package of the application class and its subpackages.

```
com.example.shop
  ShopApplication.java          // scan root
  order/OrderService.java       // found
  order/OrderRepository.java    // found
com.example.shared
  SharedClock.java              // not found unless you widen the scan
```

If a class sits in a sibling package outside that tree, scanning skips it. The usual fix is to place the application class at the root of your code, or to declare explicit `scanBasePackages` when a wider scan is intentional.

Default bean names for components come from the simple class name with the first letter lower-cased: `OrderService` becomes `orderService`. You can override the name:

```java
@Component("pricingEngine")
public class DefaultPricingEngine implements PricingEngine {
}
```

Two components with the same simple name in different packages can collide. Options include an explicit name or a fully qualified annotation bean name generator for scanning.

Scanning filters also matter. Narrow scans with `includeFilters` / `excludeFilters` when a library package should not be picked up wholesale. Broad accidental scans are a frequent cause of duplicate bean names under Boot's strict override rules. When migrating off XML, convert ordinary service classes to stereotypes package by package after the factory-heavy definitions have moved to `@Bean` methods, so construction logic stays visible while XML shrinks.

## `@Bean` Methods in `@Configuration`

`@Bean` is a method-level annotation. It is the Java equivalent of an XML `<bean>` element. You place it on a method that creates, configures, and returns the object Spring should manage.

```java
@Configuration
public class PaymentConfig {

    @Bean
    public PaymentClient paymentClient(PaymentProperties props) {
        return PaymentClient.builder()
                .baseUrl(props.baseUrl())
                .apiKey(props.apiKey())
                .build();
    }
}
```

By default the bean name is the method name (`paymentClient`). You can set an explicit name or aliases:

```java
@Bean({"paymentClient", "billingPaymentClient"})
public PaymentClient paymentClient(PaymentProperties props) {
    return PaymentClient.builder().baseUrl(props.baseUrl()).build();
}
```

`@Bean` methods can take parameters. Spring resolves those parameters from the container the same way it resolves constructor dependencies. That is the preferred way to express dependencies in lite mode, and a clear style in full mode too.

You can declare `@Bean` methods on interfaces as default methods and implement those interfaces on a `@Configuration` class. That pattern helps compose configuration fragments without deep inheritance.

Large applications also split configuration with **`@Import`**, which pulls other configuration classes into the context without relying only on component scanning:

```java
@Configuration
@Import({PaymentConfig.class, JacksonConfig.class})
public class InfraConfig {
}
```

Imported `@Configuration` classes participate like scanned ones. Prefer `@Import` over ultra-wide scan bases when you want an explicit dependency between configuration modules. This is how many auto-configurations assemble related `@Bean` methods while keeping each class focused.

Boot applications often bind external config into typed objects and feed them into those factory methods:

```java
@ConfigurationProperties(prefix = "payment")
public record PaymentProperties(String baseUrl, String apiKey) {
}
```

Enable property types with `@EnableConfigurationProperties` or `@ConfigurationPropertiesScan`, then consume them as `@Bean` parameters. That split keeps config shape in properties classes, construction in configuration, and business orchestration in `@Service` types. Avoid stuffing connection setup into a service just to stay "all components."

## Key Differences

| Topic | `@Component` (and stereotypes) | `@Bean` |
|---|---|---|
| Where you declare it | On your class | On a factory method |
| Who writes the class | Usually your code | Your code or a third-party type |
| Construction control | Container calls a constructor | You write the creation logic |
| Third-party classes | Awkward unless you wrap them | Natural fit |
| Multiple instances of one type | Separate classes or explicit names | Multiple methods, easy |
| Conditional registration | Possible with conditions on the class | Common in Boot auto-config |
| Default name | Decapitalized class name | Method name |

The practical rule many teams use:

- Own application services, repositories, and controllers: stereotypes + scanning
- Objects you cannot annotate, or need custom construction for: `@Bean`

## Full Mode vs Lite Mode

This is the detail that separates a working mental model from subtle bugs.

### Full Mode

In a `@Configuration` class with the default `proxyBeanMethods = true`, Spring creates a **CGLIB** subclass of the configuration class. Calls from one `@Bean` method to another are intercepted so the container returns the shared scoped instance instead of running the factory method again.

```java
@Configuration
public class AppConfig {

    @Bean
    public ClientDao clientDao() {
        return new ClientDaoImpl();
    }

    @Bean
    public ClientService clientService() {
        return new ClientServiceImpl(clientDao()); // intercepted: same singleton
    }
}
```

Without interception, `clientDao()` would create a second instance when called from `clientService()`. Full mode prevents that. The container looks up the existing singleton (or scoped bean) before the real factory body runs again.

Constraints in full mode:

- Configuration classes should not be final (subclassing is required)
- `@Bean` methods that participate in proxying should not be final or private
- Nested configuration classes must be static
- Configuration classes must not be declared locally inside a method
- A `@Bean` method should not return a new `@Configuration` class instance and expect it to be processed as configuration; such instances are treated as regular beans

Final-by-default code style conflicts with full mode unless you switch to lite mode. If your team marks classes final for design reasons, use `@Configuration(proxyBeanMethods = false)` with parameter injection, or keep configuration classes non-final as an intentional exception.

### Lite Mode

`@Bean` methods are in **lite mode** when:

- They live on a `@Component` (or other non-`@Configuration` bean), or
- The configuration class uses `@Configuration(proxyBeanMethods = false)`

In lite mode there is no CGLIB interception for inter-bean method calls. A direct Java call to another `@Bean` method creates a new object. Lifecycle and scope still apply when the container invokes the factory method itself.

```java
@Configuration(proxyBeanMethods = false)
public class LiteConfig {

    @Bean
    public ClientDao clientDao() {
        return new ClientDaoImpl();
    }

    @Bean
    public ClientService clientService(ClientDao clientDao) {
        // correct in lite mode: take the dependency as a parameter
        return new ClientServiceImpl(clientDao);
    }
}
```

```java
@Component
public class MetricsSupport {

    @Bean
    public MeterBinder customBinder() {
        return registry -> registry.gauge("app.ready", 1);
    }
}
```

Lite mode is lighter at runtime and is common in Boot auto-configuration classes. The tradeoff is that you must not rely on calling sibling `@Bean` methods for singleton semantics. Express collaborators as method parameters or injected fields on the containing component instead.

```
Full mode (@Configuration, proxyBeanMethods=true)
  @Bean a() calls b() --> container returns shared b

Lite mode (@Component or proxyBeanMethods=false)
  @Bean a() calls b() --> plain Java call, new instance
  Prefer: a(B b) parameter injection instead
```

A useful review question is: does this `@Bean` method call another `@Bean` method in the same class? If yes, the class needs full mode, or the call should become a method parameter. If every factory method is self-contained and only uses injected parameters, lite mode is usually enough and avoids CGLIB subclassing.

## When `@Bean` Is the Better Tool

### Third-Party Classes

You cannot add `@Component` to a library class you do not control. `@Bean` lets you construct and expose it:

```java
@Configuration
public class JacksonConfig {

    @Bean
    public ObjectMapper objectMapper() {
        return JsonMapper.builder()
                .findAndAddModules()
                .build();
    }
}
```

### Custom Construction

Builders, legacy factories, and multi-step setup fit `@Bean` methods well. You keep construction logic in one place and still let the container manage the result. That is also the right place for one-off wiring such as registering modules on an `ObjectMapper`, setting timeouts on a client, or adapting a legacy static factory into something the rest of the app can inject.

### Multiple Beans of the Same Type

```java
@Configuration
public class ClientConfig {

    @Bean
    @Primary
    public WebClient defaultWebClient(WebClient.Builder builder) {
        return builder.baseUrl("https://api.example.com").build();
    }

    @Bean
    @Qualifier("payments")
    public WebClient paymentsWebClient(WebClient.Builder builder) {
        return builder.baseUrl("https://payments.example.com").build();
    }
}
```

Scanning separate `@Component` classes can do this too, but `@Bean` keeps related factory logic together and makes names obvious.

## Bean Naming

| Declaration | Default Name |
|---|---|
| `@Component class OrderService` | `orderService` |
| `@Bean public OrderService orderService()` | `orderService` |
| `@Bean("orders")` | `orders` |
| `@Bean({"orders", "orderService"})` | `orders` plus alias `orderService` |

Names matter for `@Qualifier`, for XML or property references, and for clashes. Spring Boot fails fast when two definitions share a name and overriding is off.

Default names couple bean identity to class or method names. That is fine until a rename breaks a `@Qualifier("oldName")` string, an actuator dump consumers rely on, or a test that looks up beans by name. For beans referenced by name across modules, prefer explicit stable names:

```java
@Bean("checkoutPaymentClient")
public PaymentClient paymentClient(PaymentProperties props) {
    return PaymentClient.builder().baseUrl(props.baseUrl()).build();
}
```

For most application services, type-based injection is enough and keeps names local.

Be careful with interface return types on `@Bean` methods. Declaring a narrow return type can delay visibility of the concrete type for injection matching until the bean is instantiated. If injection points need the concrete class, declare a return type at least as specific as those injection points.

## Lifecycle: Init and Destroy

`@Bean` supports `initMethod` and `destroyMethod`:

```java
@Bean(initMethod = "start", destroyMethod = "stop")
public Worker worker() {
    return new Worker();
}
```

By default, Java-config beans with a public `close` or `shutdown` method are enlisted for destruction automatically (inferred destroy method). To disable that, set `destroyMethod = ""`.

That detail matters for resources whose lifecycle is owned elsewhere, such as a JNDI `DataSource` on an application server. Spring's documentation specifically warns about inferred destroy callbacks in that situation.

```java
@Bean(destroyMethod = "")
public DataSource dataSource() throws NamingException {
    return (DataSource) jndiTemplate.lookup("MyDS");
}
```

Component classes more often use `@PostConstruct` / `@PreDestroy`, `InitializingBean`, or `DisposableBean`. Those callbacks also work for objects created through `@Bean`. Because you are already in Java when writing a `@Bean` method, you can also call an init method yourself before returning the instance when that is clearer than container callbacks.

## Scopes

Both styles honor `@Scope`. The default is singleton.

```java
@Component
@Scope("prototype")
public class ReportBuilder {
}
```

```java
@Bean
@Scope("prototype")
public ReportBuilder reportBuilder() {
    return new ReportBuilder();
}
```

Scoped proxies and session or request scopes work with `@Bean` through `@Scope(proxyMode = ...)` or shortcut annotations such as `@RequestScope`. Keep singleton beans from holding request-scoped beans without a proxy or an `ObjectProvider` / `Provider` lookup.

In full mode, inter-bean method calls respect the target bean's scope. A singleton calling a prototype `@Bean` method through the configuration proxy still goes through the container, which is the behavior you want for lookup-style patterns.

## `@Primary`, `@Qualifier`, and Multiple Candidates

When several beans share a type, injection by type alone is ambiguous.

```java
@Service
public class BillingService {

    private final WebClient paymentsClient;

    public BillingService(@Qualifier("payments") WebClient paymentsClient) {
        this.paymentsClient = paymentsClient;
    }
}
```

`@Primary` marks the default candidate. `@Qualifier` picks a specific one. Parameter names and `@Bean` method names can also participate depending on configuration, but explicit qualifiers are clearer in reviews.

If you find yourself qualifying every injection site, consider whether the types should be different interfaces instead of many beans of one concrete type.

## Conditional Beans and Boot Auto-Configuration

Boot auto-configuration relies heavily on `@Bean` methods plus conditions such as:

- `@ConditionalOnClass`
- `@ConditionalOnMissingBean`
- `@ConditionalOnProperty`
- `@Profile`

```java
@Bean
@ConditionalOnMissingBean
public Clock clock() {
    return Clock.systemUTC();
}
```

That pattern lets an application replace a default by declaring its own bean of the same type. Because Boot disables bean-definition overriding by default, replacing by type with `@ConditionalOnMissingBean` is safer than trying to override a definition by name.

You can put conditions on `@Component` classes too, but library and auto-config code usually exposes defaults through `@Bean` factory methods. Profiles (`@Profile("worker")`) remain useful when an entire set of beans should exist only in some environments.

## Static `@Bean` Methods for Post-Processors

When a `@Bean` method returns a `BeanFactoryPostProcessor` or `BeanPostProcessor`, Spring recommends declaring it as **`static`**, ideally with no dependencies. A static factory method can be invoked without fully constructing the configuration class, which avoids eager initialization that would skip normal post-processing for other beans.

```java
@Configuration
public class EarlyConfig {

    @Bean
    public static MyBeanFactoryPostProcessor myBfpp() {
        return new MyBeanFactoryPostProcessor();
    }
}
```

Non-static BFPP `@Bean` methods can trigger lifecycle warnings and subtle ordering bugs. Treat static as the default for these extension points. The same guidance applies to many early `BeanPostProcessor` registrations.

## Bean Overriding in Spring Boot

Since Spring Boot 2.1, **bean definition overriding is disabled by default**. If two definitions share the same name, startup fails with a message that points to `spring.main.allow-bean-definition-overriding=true`.

Turning that flag on hides accidental duplicates from overlapping `@ComponentScan` ranges, mixed XML and Java config, or a local `@Bean` that collides with an auto-config name. Prefer renaming beans, narrowing component scans, or using `@ConditionalOnMissingBean` when a replaceable default is intentional.

If you still load XML with `@ImportResource` during a migration, treat XML bean ids as part of the same global name space. Move third-party and factory-heavy definitions to `@Bean` methods first, then convert ordinary service classes to stereotypes package by package.

## Constructor Injection

For `@Component` types, a single constructor is autowired automatically in modern Spring. For `@Bean` methods, parameters are the injection points.

```java
@Service
public class InvoiceService {

    private final InvoiceRepository invoices;
    private final Clock clock;

    public InvoiceService(InvoiceRepository invoices, Clock clock) {
        this.invoices = invoices;
        this.clock = clock;
    }
}
```

```java
@Bean
public InvoiceService invoiceService(InvoiceRepository invoices, Clock clock) {
    return new InvoiceService(invoices, clock);
}
```

Both styles can express the same graph. Stereotypes keep the class focused on behavior. `@Bean` keeps construction policy in configuration when the class should stay free of Spring annotations, which helps if the same class is used outside a Spring container in unit tests or other runtimes.

## Testing Implications

Tests are often where `@Bean` versus `@Component` choices become visible. A production `@Service` is hard to swap unless the test context excludes it or marks a replacement `@Primary`. A production collaborator exposed only through a `@Bean` method is usually easier to replace with a `@TestConfiguration` factory that returns a fake or a fixed clock.

Slice tests and test configuration often replace production beans:

```java
@SpringBootTest
class OrderFlowTests {

    @TestConfiguration
    static class TestClockConfig {
        @Bean
        @Primary
        Clock fixedClock() {
            return Clock.fixed(Instant.parse("2026-11-09T00:00:00Z"), ZoneOffset.UTC);
        }
    }
}
```

`@TestConfiguration` / `@Bean` is a natural way to install fakes. If a production `@Component` of the same type is also present, use `@Primary`, test slice filters, or exclude the real component so the context stays unambiguous.

Lite-mode surprises show up in tests too: a hand-written config that calls sibling `@Bean` methods without full mode can create extra instances that bypass mocks. Prefer parameter injection in test configuration classes, or keep `proxyBeanMethods` enabled when you intentionally use inter-bean calls.

## Putting It Together

A small application often looks like this:

```java
@SpringBootApplication
public class ShopApplication {
    public static void main(String[] args) {
        SpringApplication.run(ShopApplication.class, args);
    }
}

@RestController
class OrderController {
    private final OrderService orders;
    OrderController(OrderService orders) { this.orders = orders; }
}

@Service
class OrderService {
    private final OrderRepository orders;
    private final PaymentClient payments;
    OrderService(OrderRepository orders, PaymentClient payments) {
        this.orders = orders;
        this.payments = payments;
    }
}

@Repository
class JdbcOrderRepository implements OrderRepository {
    // persistence code
}

@Configuration
class PaymentConfig {
    @Bean
    PaymentClient paymentClient(PaymentProperties props) {
        return PaymentClient.builder().baseUrl(props.baseUrl()).build();
    }
}
```

Owned types use stereotypes. The HTTP client from elsewhere uses `@Bean`. The container wires them through constructors. That split scales: feature packages keep `@Service` / `@Repository` / `@RestController` types, while infrastructure packages keep `@Configuration` classes for clients, mappers, and conditional defaults.

When the application grows, resist the urge to mark every helper with `@Component`. Ask whether the type needs a managed lifecycle, injection points, or a replaceable default. Pure functions, records used as DTOs, and short-lived value objects usually stay outside the container. Fewer beans mean fewer name clashes and a clearer graph in actuator and test contexts.

## Common Mistakes

- Calling sibling `@Bean` methods in lite mode and expecting a singleton.
- Putting `@Configuration` on a final class while leaving `proxyBeanMethods` at true.
- Annotating a third-party class by subclassing only to attach `@Component`, when a `@Bean` method would be clearer.
- Scanning the same package twice and hitting Boot's "overriding is disabled" failure.
- Relying on inferred `close`/`shutdown` destroy methods for a resource owned outside the container.
- Declaring non-static `@Bean` methods that return `BeanFactoryPostProcessor`.
- Using field injection in components and then struggling to test or reason about required dependencies.
- Expecting `@Service` to add transactional behavior by itself; transactions still need `@Transactional` and a transaction manager.
- Declaring two `@Bean` methods with the same method name in imported configuration classes and assuming one silently wins.

## Step by Step Decision Guide

| Situation | Prefer |
|---|---|
| Application service / repository / controller you own | `@Service` / `@Repository` / `@RestController` |
| Third-party class | `@Bean` |
| Builder or multi-step setup | `@Bean` |
| Several instances of one library type | `@Bean` methods + `@Qualifier` / `@Primary` |
| Replaceable Boot default | `@Bean` + `@ConditionalOnMissingBean` |
| Simple owned POJO with one implementation | `@Component` family |
| Need inter-bean method calls in one class | `@Configuration` full mode, or parameter injection |
| Want to avoid CGLIB on a config class | `@Configuration(proxyBeanMethods = false)` + parameters |
| BFPP / BPP registration | static `@Bean` |

## Quick Reference

| Question | Short Answer |
|---|---|
| Class-level or method-level? | `@Component` class-level; `@Bean` method-level |
| XML analog of `@Bean`? | `<bean>` |
| Is `@Configuration` a component? | Yes; it is meta-annotated with `@Component` |
| Full mode default? | `proxyBeanMethods = true` |
| Lite mode means? | No inter-bean call interception |
| Boot override default? | Overriding disabled |
| BFPP `@Bean` style? | `static` method |
| Inferred destroy methods? | Public `close` / `shutdown` unless disabled |

## Conclusion

`@Component` and `@Bean` are two doors into the same IoC container. Stereotypes and scanning are the straightforward path for code you own. `@Bean` methods are the controlled path for third-party types, custom construction, conditionals, and auto-configuration defaults.

The sharp edge is configuration mode. Full `@Configuration` proxies inter-bean method calls so singletons stay singletons. Lite mode does not. Once that distinction is clear, most `@Bean` versus `@Component` debates reduce to a simple ownership question: can you annotate the class, and do you need to own the construction recipe?

Use stereotypes for application code, `@Bean` for integration and construction policy, prefer constructor or factory-method parameter injection, and keep Boot's no-override default as a safety rail rather than a switch to flip at the first clash.

If you remember only one workflow, make it this: scan what you own, factory-method what you integrate, inject through constructors and parameters, and treat a bean name clash as a design signal instead of a property to silence.
