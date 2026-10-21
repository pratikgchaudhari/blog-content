---
title: Top 100 Spring Boot Interview Questions with Concise Answers
date: 2026-10-21
summary: Curated list of the top 100 Spring Boot interview questions with short, crisp answers.
tag: spring-boot, java, interview-questions, backend, spring-framework
draft: false
---

## Basics & Core Concepts

1. **What is Spring Boot?**  
   Spring Boot is an opinionated framework on top of the Spring Framework that simplifies building production-ready, stand-alone Spring applications via auto-configuration, starter dependencies, and embedded servers.

2. **How is Spring Boot different from the Spring Framework?**  
   Spring provides core features like DI and AOP but requires manual configuration. Spring Boot adds auto-configuration, embedded servers, starters, and Actuator for rapid development with minimal setup.

3. **What does the @SpringBootApplication annotation do?**  
   It is a meta-annotation combining `@SpringBootConfiguration` (or `@Configuration`), `@EnableAutoConfiguration`, and `@ComponentScan`. It bootstraps the application and enables auto-configuration and component scanning.

4. **What is auto-configuration in Spring Boot?**  
   It automatically configures beans based on the classpath, properties, and conditions (e.g., `@ConditionalOnClass`, `@ConditionalOnMissingBean`) so you only override defaults when needed.

5. **How does Spring Boot find auto-configuration classes?**  
   From `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` (or the older `spring.factories` in earlier versions). Classes are loaded conditionally.

6. **What are Spring Boot starters?**  
   Curated dependency descriptors (POMs) that pull in a compatible set of libraries for a feature, e.g., `spring-boot-starter-web` for MVC + Tomcat + Jackson.

7. **What is the spring-boot-starter-parent?**  
   A parent POM that manages dependency versions via the Spring Boot BOM and provides sensible defaults for plugins and properties.

8. **How do you create a Spring Boot project?**  
   Primarily via Spring Initializr (start.spring.io), or manually with Maven/Gradle, or using the Spring Boot CLI for Groovy.

9. **What is an embedded server in Spring Boot?**  
   A server like Tomcat (default), Jetty, or Undertow bundled inside the application so it runs as a standalone executable JAR without an external container.

10. **What is the default embedded server and how do you change it?**  
    Tomcat. Exclude `spring-boot-starter-tomcat` and add `spring-boot-starter-jetty` (or Undertow, though Undertow support was removed in Boot 4).

## Configuration & Profiles

11. **What is application.properties / application.yml used for?**  
    Externalized configuration for server port, database, logging, custom properties, etc. YAML supports nested structures better.

12. **What is the order of precedence for configuration properties?**  
    Command-line args > Java system properties > OS environment variables > profile-specific files > default `application.properties/yml` > Spring Boot defaults.

13. **How do you override default properties?**  
    Via `application.properties/yml`, environment variables, command-line arguments, or `@TestPropertySource` in tests.

14. **What are Spring profiles?**  
    Named sets of configuration and beans for different environments (dev, test, prod). Activate with `spring.profiles.active`.

15. **How do you activate a profile?**  
    `spring.profiles.active=prod` in properties, `--spring.profiles.active=prod` on the command line, or `SPRING_PROFILES_ACTIVE` environment variable.

16. **What is @Value annotation?**  
    Injects individual property values from the Environment into fields or parameters.

17. **What is @ConfigurationProperties?**  
    Binds a group of related properties (with a prefix) to a POJO, supporting nested objects, lists, and validation. Preferred over multiple `@Value` for structured config.

18. **What is externalized configuration?**  
    Configuration outside the code (files, env vars, args) so the same artifact can run in different environments without recompilation.

19. **How do you disable auto-configuration for a specific class?**  
    Use `@SpringBootApplication(exclude = SomeAutoConfiguration.class)` or `spring.autoconfigure.exclude` property.

20. **What is the purpose of spring.main.web-application-type=none?**  
    Disables the embedded web server for non-web (batch/CLI) applications.

## Dependency Injection & Beans

21. **Why is constructor injection preferred?**  
    Makes dependencies explicit and immutable (`final`), fails fast if missing, and is easier to unit-test without the Spring container. Single-constructor classes don't need `@Autowired` (since Spring 4.3).

22. **What are the differences between @Component, @Service, @Repository, and @Controller?**  
    All are `@Component` stereotypes. `@Service` is for business logic, `@Repository` enables persistence exception translation, `@Controller`/`@RestController` for web handlers. Semantic + tooling differences.

23. **When do you use @Bean vs @Component?**  
    `@Component` (and stereotypes) for classes you control that are scanned. `@Bean` methods in `@Configuration` classes for third-party objects or when custom construction logic is needed.

24. **What are bean scopes in Spring?**  
    `singleton` (default, one per container), `prototype` (new instance each request), and web scopes: `request`, `session`, `application`, `websocket`.

25. **What do @Primary and @Qualifier do?**  
    `@Primary` marks the preferred bean when multiple candidates exist. `@Qualifier` explicitly selects a named bean, overriding `@Primary`.

26. **What is the difference between CommandLineRunner and ApplicationRunner?**  
    Both execute after the context is ready. `CommandLineRunner` receives raw `String... args`; `ApplicationRunner` receives structured `ApplicationArguments`. Use `@Order` for sequencing.

27. **What is lazy initialization?**  
    Beans are created only when first requested (`@Lazy` or `spring.main.lazy-initialization=true`). Useful for faster startup but can hide errors until runtime.

28. **What is the difference between @Autowired and @Resource?**  
    `@Autowired` is by type (Spring). `@Resource` is by name (JSR-250). Prefer constructor injection with `@Autowired` or implicit single constructor.

29. **How does Spring handle circular dependencies?**  
    By default, it fails for constructor injection. Field/setter injection can sometimes resolve via proxies, but circular dependencies indicate design issues and should be avoided.

30. **What is @ConditionalOnMissingBean?**  
    A condition that creates a bean only if no bean of the same type (or name) already exists, allowing user configuration to override auto-configuration.

## REST & Web Layer

31. **What is the difference between @Controller and @RestController?**  
    `@RestController` = `@Controller` + `@ResponseBody`. Methods return data (JSON/XML) directly instead of view names.

32. **Explain @RequestParam, @PathVariable, and @RequestBody.**  
    `@PathVariable` extracts from URI path (`/users/{id}`). `@RequestParam` from query/form parameters. `@RequestBody` deserializes the request body into an object.

33. **How do you handle exceptions globally?**  
    Use `@RestControllerAdvice` (or `@ControllerAdvice`) with `@ExceptionHandler` methods. Return `ProblemDetail` (RFC 9457) for standardized errors. Enable with `spring.mvc.problemdetails.enabled=true`.

34. **How does request validation work?**  
    Add `spring-boot-starter-validation`. Annotate DTOs with constraints (`@NotNull`, `@Size`, etc.) and use `@Valid` on controller parameters. Failures throw `MethodArgumentNotValidException`.

35. **What is the difference between @Valid and @Validated?**  
    `@Valid` is the standard Bean Validation trigger. `@Validated` (Spring) supports validation groups and method-level validation.

36. **How do you enable CORS?**  
    Class/method `@CrossOrigin`, global `WebMvcConfigurer.addCorsMappings`, or `CorsConfigurationSource` in the security filter chain. Prefer specific origins over `*`.

37. **What is content negotiation?**  
    Spring selects the response format (JSON, XML) based on the `Accept` header or URL extension, using `HttpMessageConverters`.

38. **How do you return a custom HTTP status?**  
    Use `ResponseEntity.status(HttpStatus.CREATED).body(...)` or `@ResponseStatus` on methods/exceptions.

39. **What is the difference between @GetMapping and @RequestMapping?**  
    `@GetMapping` is a composed annotation for HTTP GET only. `@RequestMapping` supports all methods and is more general.

40. **How do you consume/produce specific media types?**  
    Use `consumes` and `produces` attributes on mapping annotations, or `Content-Type`/`Accept` headers.

## Data Access & JPA

41. **What does spring-boot-starter-data-jpa provide?**  
    Spring Data JPA, Hibernate, HikariCP connection pool, and auto-configuration of `DataSource`, `EntityManagerFactory`, and transaction manager.

42. **What is the difference between CrudRepository and JpaRepository?**  
    `CrudRepository` provides basic CRUD. `JpaRepository` extends it with JPA-specific features like `flush()`, batch operations, and pagination support.

43. **How do derived query methods work?**  
    Method names like `findByEmailAndActiveTrue` are parsed by Spring Data to generate queries automatically.

44. **What is the N+1 query problem and how do you fix it?**  
    Loading a collection triggers one query per association due to lazy loading. Fix with `JOIN FETCH`, `@EntityGraph`, batch fetching, or DTO projections. Disable open-in-view if possible.

45. **What does @Transactional do?**  
    Declares that a method runs inside a transaction. By default, rolls back on unchecked exceptions. Supports propagation, isolation, and timeout attributes.

46. **What are common @Transactional pitfalls?**  
    Self-invocation bypasses the proxy (no transaction), only public methods are proxied, and default rollback is only for RuntimeExceptions. Prefer short, focused transactions.

47. **What is transaction propagation?**  
    Defines how a transactional method joins an existing transaction. Common: `REQUIRED` (default, join or create), `REQUIRES_NEW` (suspend and create new), `SUPPORTS`, `NOT_SUPPORTED`, `MANDATORY`, `NEVER`.

48. **How do you manage schema migrations?**  
    Use Flyway or Liquibase. Place versioned scripts in `db/migration`. Spring Boot auto-runs them on startup. Avoid `ddl-auto=update` in production.

49. **What is spring.jpa.hibernate.ddl-auto?**  
    Controls Hibernate schema generation: `none` (default for non-embedded), `validate`, `update`, `create`, `create-drop`. Prefer migrations over `update`.

50. **What is the difference between JPA and Hibernate?**  
    JPA is the specification (API). Hibernate is the most common implementation.

## Security

51. **What happens when you add spring-boot-starter-security?**  
    All endpoints require authentication by default. A default user is created with a random password logged at startup. Form login and HTTP Basic are enabled.

52. **How do you configure security in modern Spring Boot (no WebSecurityConfigurerAdapter)?**  
    Define a `SecurityFilterChain` bean using the lambda DSL: `http.authorizeHttpRequests(...).oauth2ResourceServer(...).csrf(...)`.

53. **How do you secure a REST API with JWT?**  
    Use `spring-boot-starter-oauth2-resource-server`, configure `issuer-uri` or `jwk-set-uri`, and enable JWT validation in the security filter chain. Stateless, no sessions.

54. **When should you disable CSRF?**  
    For stateless APIs using bearer tokens (JWT) in headers, as CSRF protects cookie-based sessions. Keep it enabled for browser form-based apps.

55. **How does method-level security work?**  
    Enable with `@EnableMethodSecurity`. Use `@PreAuthorize("hasRole('ADMIN')")` or SpEL expressions. Applied via AOP proxies (self-invocation caveat applies).

56. **What is the difference between authentication and authorization?**  
    Authentication verifies identity (who you are). Authorization checks permissions (what you can do).

57. **How do you implement custom authentication?**  
    Implement `AuthenticationProvider` or use OAuth2/JWT resource server configuration, or custom filters in the security chain.

58. **What is Spring Security's filter chain?**  
    A chain of filters that handle authentication, authorization, CSRF, CORS, etc. Order matters; customize via `SecurityFilterChain`.

## Testing

59. **What does @SpringBootTest do?**  
    Loads the full application context. Can start an embedded server. Useful for integration tests but slower than slice tests.

60. **What is the difference between @WebMvcTest, @DataJpaTest, and @SpringBootTest?**  
    `@WebMvcTest` slices the web layer (controllers + MockMvc). `@DataJpaTest` slices the JPA layer (repositories + in-memory DB). `@SpringBootTest` loads everything.

61. **How do you test REST controllers?**  
    Use `@WebMvcTest` + `MockMvc` to perform requests and assert status, content, and headers without starting a full server.

62. **What is @MockBean (and its replacement in Boot 4)?**  
    Replaces a bean with a Mockito mock in the context. In Spring Boot 4, use `@MockitoBean` (or `@MockitoSpyBean`).

63. **How do you test with profiles?**  
    Use `@ActiveProfiles("test")` or `@SpringBootTest(properties = "spring.profiles.active=test")`.

## Actuator, Monitoring & Production

64. **What is Spring Boot Actuator?**  
    Provides production-ready endpoints for health, metrics, info, environment, loggers, etc. (`/actuator/health`, `/actuator/metrics`).

65. **How do you expose Actuator endpoints?**  
    By default only `health` and `info` are exposed. Use `management.endpoints.web.exposure.include=*` (carefully) or specific ones. Secure them.

66. **What is the health endpoint?**  
    Aggregates health indicators (DB, disk space, custom). Returns `UP`/`DOWN`. Supports liveness and readiness probes for Kubernetes.

67. **How do you expose metrics?**  
    Actuator + Micrometer. Common registries: Prometheus (`/actuator/prometheus`), Datadog, etc. Use `@Timed` or custom meters.

68. **What is graceful shutdown?**  
    Enabled by default in recent versions. Allows in-flight requests to complete before shutdown. Configure with `server.shutdown=graceful` and timeout.

69. **How do you enable HTTP/2?**  
    Set `server.http2.enabled=true` (requires HTTPS in most cases).

## Advanced Topics

70. **What is @Async and how do you enable it?**  
    Runs a method in a separate thread. Enable with `@EnableAsync`. Configure a custom `TaskExecutor` for control. Return `CompletableFuture` or `void`.

71. **How do you implement caching?**  
    Add `spring-boot-starter-cache`, `@EnableCaching`, and use `@Cacheable`, `@CachePut`, `@CacheEvict`. Supports Caffeine, Redis, Ehcache, etc.

72. **How do you schedule tasks?**  
    `@EnableScheduling` + `@Scheduled(fixedRate=..., fixedDelay=..., cron=...)` on methods. Use a custom `TaskScheduler` for control.

73. **What is the difference between fixedRate and fixedDelay?**  
    `fixedRate`: interval between method *starts*. `fixedDelay`: interval between method *completion* and next start.

74. **How do you use WebClient vs RestTemplate vs RestClient?**  
    `RestTemplate` is legacy blocking. `RestClient` (Boot 3.2+) is the modern blocking fluent API. `WebClient` is reactive/non-blocking (WebFlux).

75. **What is Spring WebFlux?**  
    Reactive web framework on Project Reactor. Non-blocking, suitable for high-concurrency, streaming, or backpressure scenarios. Uses Netty by default.

76. **How do you configure multiple data sources?**  
    Define multiple `DataSource` beans with `@Primary` and `@Qualifier`, plus separate `EntityManagerFactory` and `TransactionManager` configurations.

77. **What is @ConditionalOnProperty?**  
    Creates a bean only if a property matches a value (or is present). Useful for feature flags.

78. **How does DevTools work?**  
    Provides automatic restart on classpath changes, LiveReload, and remote debugging support. Exclude from production.

79. **What is the difference between JAR and WAR packaging?**  
    JAR with embedded server is preferred (standalone). WAR is for deployment to an external servlet container.

80. **How do you package a Spring Boot app as a Docker image?**  
    Use the Spring Boot Maven/Gradle plugin's `build-image` goal (Cloud Native Buildpacks) or a Dockerfile with multi-stage builds.

## Microservices & Cloud

81. **What is Spring Cloud?**  
    A set of tools for building distributed systems on Spring Boot: service discovery, config server, circuit breakers, API gateway, etc.

82. **What is service discovery?**  
    Dynamic registration and lookup of service instances (e.g., Eureka, Consul, or Kubernetes DNS) so clients don't hardcode addresses.

83. **What is a circuit breaker?**  
    A resilience pattern (Resilience4j) that fails fast and provides fallbacks when a downstream service is unhealthy, preventing cascade failures.

84. **What is Spring Cloud Config?**  
    Centralized external configuration server that serves properties from Git or other backends, with support for encryption and profiles.

85. **What is an API Gateway in Spring Cloud?**  
    Spring Cloud Gateway routes requests, applies filters (auth, rate limiting, path rewriting), and acts as the single entry point.

86. **How do you implement distributed tracing?**  
    Micrometer Tracing + OpenTelemetry (or Zipkin/Brave). Propagates trace IDs across services via headers.

## Recent Changes & Best Practices (Boot 3/4)

87. **What are the key changes in Spring Boot 3?**  
    Jakarta EE namespace (`jakarta.*`), Java 17 minimum, native image support, ProblemDetail errors, virtual threads support (Java 21), Micrometer Observation.

88. **What are major changes in Spring Boot 4?**  
    Spring Framework 7, Jackson 3 (`tools.jackson`), modular starters (e.g., `spring-boot-starter-webmvc`), Undertow removed, JUnit 4 removed, `@MockBean` replaced by `@MockitoBean`, built-in retry, API versioning support.

89. **Why was Undertow removed in Boot 4?**  
    Lack of support for Servlet 6.1 (Jakarta EE 11). Use Tomcat 11 or Jetty 12.

90. **How do you handle Jackson 3 migration?**  
    Package change from `com.fasterxml.jackson` to `tools.jackson`. Update imports; optionally set `spring.jackson.use-jackson2-defaults=true` for compatibility.

91. **What is the recommended migration path to Boot 4?**  
    Upgrade to Boot 3.5 first, eliminate all deprecation warnings, then migrate to 4.x. Use the properties migrator dependency temporarily.

92. **What is native image support?**  
    GraalVM native compilation for faster startup and lower memory. Requires careful configuration of reflection, resources, and dynamic proxies.

93. **How do you enable virtual threads?**  
    `spring.threads.virtual.enabled=true` (Java 21+). Suitable for I/O-bound workloads; be cautious with synchronized blocks and pinning.

94. **What is API versioning support in Boot 4?**  
    Native support via `@GetMapping(version = "2.0")` or headers/paths, with auto-configuration for MVC and WebFlux.

95. **Why prefer RestClient over RestTemplate?**  
    RestTemplate is in maintenance mode. RestClient offers a modern, fluent, builder-style API with better defaults and is the recommended blocking client.

## Miscellaneous & Practical

96. **How do you log in Spring Boot?**  
    SLF4J + Logback (default). Configure levels in properties (`logging.level.com.example=DEBUG`). Use structured logging for production.

97. **What is the difference between @ControllerAdvice and @RestControllerAdvice?**  
    `@RestControllerAdvice` is `@ControllerAdvice` + `@ResponseBody`, so handlers return data directly (ideal for REST).

98. **How do you customize the error response?**  
    Implement `ErrorController`, use `@ControllerAdvice`, or rely on `ProblemDetail`. Override `BasicErrorController` if needed.

99. **What is the purpose of @EnableAutoConfiguration?**  
    Triggers auto-configuration. Usually not used directly because it is included in `@SpringBootApplication`.

100. **What are best practices for Spring Boot applications?**  
    Prefer constructor injection, keep transactions short, use profiles, externalize config, secure Actuator, use Flyway/Liquibase, write slice tests, monitor with Actuator + metrics, and follow the principle of convention over configuration while overriding only when necessary.