---
title: OWASP Top 10 2025 Explained - Web Application Security Risks and How to Mitigate Them
date: 2026-11-22
summary: A practical guide to the OWASP Top 10:2025 risks, what changed from 2021, and how to mitigate each category in Spring Boot applications.
tag: owasp, security, spring-boot, spring-security, java
draft: false
related: prepared-statement-in-java,how-git-works-internally,how-dns-works,rag-chatbot-internal-documents,load-balancing-explained
---

The **OWASP Top 10** is a standard awareness document for the most critical web application security risks. Teams use it as a shared language: product managers, developers, and security reviewers can point to the same ten categories when they talk about what can go wrong and what to fix first.

**OWASP** (Open Worldwide Application Security Project) builds the list from contributed testing data and a community survey. The data looks backward at what scanners and testers find at scale. The survey fills gaps for risks that are hard to measure automatically. The result is data-informed, not blindly data-driven: categories are ranked with that mix of evidence in mind, and the project leaders publish how they grouped CWEs and how they used exploit and impact scoring.

As of November 2026, the current official edition is **OWASP Top 10:2025**, published at [owasp.org/Top10/2025](https://owasp.org/Top10/2025/). It is the eighth installment of the Top Ten. This article walks through that edition category by category, notes what changed from 2021, and shows Spring Boot 3 / Spring Security 6 patterns for common fixes. The goal is a clear working model, not a certification checklist.

## How the List Is Built

OWASP asks vendors, bug bounty platforms, and organizations for testing results across large sets of applications. Contributors report how many applications were tested and how many had at least one finding for a given CWE. Prevalence in the application population matters more than how many times the same bug is repeated inside one app.

That dataset is incomplete by nature. New attack classes take time to become testable at scale. Some risks never show up cleanly in scanners. OWASP therefore uses a community survey so practitioners can elevate risks that the data underrepresents. In 2025, software supply chain pressure and logging/alerting gaps are good examples of that tension between "easy to count" and "painful in practice."

Categories focus on **root causes** when possible (for example cryptographic failure or misconfiguration) rather than only symptoms (such as sensitive data exposure). Each Top 10 entry groups many CWEs. Not every CWE applies to every language, which is one reason OWASP keeps categories instead of publishing ten single CWE identifiers.

## What Changed From 2021

The 2021 list is still common in older courses and checklists. The 2025 edition reshuffles ranks, renames two categories, expands one, folds **SSRF** into access control, and adds a new tenth category.

| 2021 | 2025 |
|---|---|
| A01 Broken Access Control | A01 Broken Access Control (SSRF folded in) |
| A02 Cryptographic Failures | A02 Security Misconfiguration (up from #5) |
| A03 Injection | A03 Software Supply Chain Failures (expanded from A06:2021) |
| A04 Insecure Design | A04 Cryptographic Failures (down from #2) |
| A05 Security Misconfiguration | A05 Injection (down from #3) |
| A06 Vulnerable and Outdated Components | A06 Insecure Design (down from #4) |
| A07 Identification and Authentication Failures | A07 Authentication Failures (renamed) |
| A08 Software and Data Integrity Failures | A08 Software or Data Integrity Failures |
| A09 Security Logging and Monitoring Failures | A09 Security Logging and Alerting Failures (renamed) |
| A10 Server-Side Request Forgery (SSRF) | A10 Mishandling of Exceptional Conditions (new) |

Two themes stand out. Configuration and supply chain moved up because modern systems put more behavior into config, dependencies, and build pipelines. Standalone SSRF is gone as its own Top 10 entry because OWASP rolled it into Broken Access Control. Authentication and logging categories were renamed to match how failures actually show up: authentication flows, and alerts that drive response.

## The 2025 List at a Glance

1. **A01** Broken Access Control
2. **A02** Security Misconfiguration
3. **A03** Software Supply Chain Failures
4. **A04** Cryptographic Failures
5. **A05** Injection
6. **A06** Insecure Design
7. **A07** Authentication Failures
8. **A08** Software or Data Integrity Failures
9. **A09** Security Logging and Alerting Failures
10. **A10** Mishandling of Exceptional Conditions

```
Request
  |
  v
Authn / session (A07)
  |
  v
Access control (A01, includes SSRF checks)
  |
  v
Input handling (A05) + design limits (A06)
  |
  v
Crypto / secrets (A04) + config (A02)
  |
  v
Dependencies + build (A03, A08)
  |
  v
Errors + logs + alerts (A10, A09)
```

## A01 Broken Access Control

**Broken access control** means a user can act outside the permissions you intended. That includes reading or changing another user's data, calling an admin API as a normal user, abusing CORS, forging a state-changing request (CSRF), or making the server fetch an internal URL on the attacker's behalf (**SSRF**, now part of this category).

OWASP keeps this category at #1. Notable CWEs listed for the category include **CWE-200**, **CWE-201**, **CWE-918** (SSRF), and **CWE-352** (CSRF).

### How Attacks Look

- Change an `id` in the URL or JSON body to another account (**insecure direct object reference**).
- Call `PUT` / `DELETE` endpoints that the UI never shows but the API still accepts.
- Replay or tweak a JWT claim such as `role`.
- Force-browse `/admin` as a standard user.
- Point a "fetch URL" feature at a link-local metadata endpoint or an internal admin host (SSRF).

### Concrete Example

Imagine an orders API that accepts `userId` from the client. The attacker keeps their session cookie but swaps `userId` to another customer. If the server trusts that parameter, every order becomes readable.

### Vulnerable vs Fixed (Spring)

```java
// Vulnerable: trusts the client-supplied user id
@GetMapping("/api/orders/{orderId}")
public Order getOrder(@PathVariable long orderId, @RequestParam long userId) {
    return orderRepository.findByIdAndUserId(orderId, userId)
            .orElseThrow();
}
```

```java
// Fixed: ownership comes from the authenticated principal
@GetMapping("/api/orders/{orderId}")
public Order getOrder(@PathVariable long orderId, Authentication auth) {
    long userId = currentUserId(auth);
    return orderRepository.findByIdAndUserId(orderId, userId)
            .orElseThrow();
}
```

```java
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health").permitAll()
                .requestMatchers("/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated());
        return http.build();
    }
}
```

### Mitigations

- Deny by default outside public resources.
- Enforce access on the server, never only in the UI.
- Prefer centralized authorization (`@PreAuthorize`, a shared policy component, or a gateway policy).
- Model record ownership in queries and domain services.
- Invalidate server sessions on logout; keep JWTs short-lived.
- For SSRF, allowlist outbound hosts and schemes; block link-local and private ranges unless required.
- Enable CSRF protection for cookie-based browser sessions.
- Rate-limit sensitive APIs to slow automated probing.

## A02 Security Misconfiguration

**Security misconfiguration** covers unsafe defaults, incomplete setups, open cloud storage, verbose error pages in production, unnecessary features enabled, missing security headers, and inconsistent configs across environments. OWASP moved this category up to #2 in 2025 because more application behavior lives in configuration.

### How Attacks Look

- Hit `/actuator` endpoints that expose env vars or dumps.
- Use a default admin password left in a sample compose file.
- Read stack traces that reveal framework versions and SQL fragments.
- Abuse an open CORS policy that reflects arbitrary origins with credentials.
- Find a directory listing or leftover `.git` metadata under the web root.

### Concrete Example

A Spring Boot app ships with broad actuator exposure in a shared "debug" profile that accidentally reaches production. The attacker does not need an application bug; the operations surface is the bug.

### Vulnerable vs Fixed (Spring Boot)

```yaml
# Vulnerable posture in production
management.endpoints.web.exposure.include: "*"
spring.jpa.show-sql: true
server.error.include-stacktrace: always
```

```yaml
# Tighter posture
management.endpoints.web.exposure.include: health,info
management.endpoint.health.show-details: when_authorized
server.error.include-stacktrace: never
server.error.include-message: never
```

```java
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http.headers(headers -> headers
            .contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'self'")));
    return http.build();
}
```

### Mitigations

- Harden every environment, not only production.
- Remove unused endpoints, default accounts, and sample apps.
- Keep a repeatable baseline (Infrastructure as Code, reviewed Boot config).
- Separate secrets from config files; inject them from a secret manager.
- Review cloud IAM, storage ACLs, and security groups the same way you review code.
- Automate config drift detection between the approved baseline and live systems.

## A03 Software Supply Chain Failures

**Software supply chain failures** expand the older "vulnerable and outdated components" idea. The risk now includes malicious or compromised dependencies, build systems, artifact repositories, IDE tooling, and distribution channels, not only known CVEs in libraries you knowingly chose.

OWASP notes that this area was ranked at the top of the community survey even though it is hard to capture fully in traditional app testing data. Official example scenarios include the SolarWinds compromise, Log4Shell (**CVE-2021-44228**), a Struts remote code execution issue (**CVE-2017-5638**), and package-ecosystem worms that abuse publish tokens on developer machines.

### How Attacks Look

- A transitive dependency ships a critical RCE; your app calls the vulnerable path.
- A maintainer account is taken over; a new package version runs install-time code.
- The CI runner has long-lived cloud credentials and can push to production alone.
- You build from an unsigned artifact mirrored from an untrusted registry.
- A developer workstation token is stolen and used to publish lookalike packages.

### Concrete Example

Your service depends on a logging library. A remote code execution flaw lands in that library. Patch delay is measured in weeks because "dependency upgrades" are scheduled quarterly. During that window, internet-facing apps that process untrusted input through the vulnerable path are exposed. That is the older "outdated component" story, now treated as one slice of a wider supply chain category.

### Mitigations

- Generate and review an **SBOM**; track direct and transitive dependencies.
- Use SCA tools (for Java, OWASP Dependency-Check or commercial equivalents) in CI.
- Pin versions; prefer signed packages from official sources over insecure mirrors.
- Separate duties in CI/CD: no single identity both commits and ships unreviewed.
- Patch on a risk-based schedule; do not wait for a quarterly window when the issue is internet-facing and critical.
- Harden package registries, branch protections, and developer workstation access.
- Stage rollouts so a compromised upstream update does not hit every node at once.

Treat the build pipeline as part of the product trust boundary. If CI can deploy, CI is production-adjacent.

## A04 Cryptographic Failures

**Cryptographic Failures** are weaknesses in how data is protected in transit and at rest: weak algorithms, poor key management, missing TLS, passwords stored with outdated hashes, or secrets hard-coded in source. Failures here often lead to sensitive data exposure or easier account takeover.

### How Attacks Look

- Intercept HTTP traffic on a shared network and read session cookies.
- Crack unsalted SHA-1 password hashes from a leaked database.
- Find an API key committed to Git history.
- Use a homemade "encryption" routine that is just Base64 or a static XOR key.

### Concrete Example

Passwords hashed with a fast digest and no salt can be attacked offline after a database leak. The application "encrypted" nothing meaningful; it only transformed the secret into another value attackers can grind through.

### Vulnerable vs Fixed

```java
// Vulnerable
String hashed = DigestUtils.md5DigestAsHex(password.getBytes());
```

```java
// Fixed: adaptive password hashing through Spring Security
@Bean
PasswordEncoder passwordEncoder() {
    return PasswordEncoderFactories.createDelegatingPasswordEncoder();
}
```

```yaml
server.ssl.enabled: true
# Terminate TLS at the load balancer only if the app network is private
# and you still enforce secure cookies and HSTS at the edge
```

### Mitigations

- Use TLS everywhere data crosses a trust boundary.
- Store passwords with a modern adaptive hash (bcrypt, argon2, or the platform default encoder).
- Prefer established libraries; do not invent crypto.
- Manage keys in a KMS or secret manager; rotate them.
- Classify data and encrypt sensitive fields when the threat model requires it.
- Turn on HSTS at the edge once HTTPS is solid.

## A05 Injection

**Injection** happens when untrusted input is interpreted as commands or queries. Classic forms include SQL, NoSQL, OS command, LDAP, and template injection. OWASP also treats **cross-site scripting** (**CWE-79**) as part of this category in 2025. The shared root cause is mixing data with code.

Injection remains heavily tested and carries a large CVE count across its mapped CWEs. XSS tends to appear often with lower average impact; SQL injection appears less often in some datasets but with higher impact when it lands.

### How Attacks Look

```
GET /accounts?id=' OR '1'='1
```

```java
// Vulnerable SQL concatenation
String sql = "SELECT * FROM accounts WHERE cust_id = '" + custId + "'";
```

```java
// Vulnerable command construction
Runtime.getRuntime().exec("nslookup " + domain);
```

```java
// Vulnerable HQL concatenation (still injection)
session.createQuery("FROM Account WHERE custId = '" + custId + "'");
```

### Concrete Example

A search box concatenates user text into SQL. The attacker closes the quote, adds `OR 1=1`, and dumps rows the UI never meant to show. The same idea applies to OS commands, LDAP filters, and HTML pages that reflect input without encoding.

### Fixed Patterns (Spring / Jakarta)

```java
// Parameterized JDBC
jdbcTemplate.query(
        "SELECT * FROM accounts WHERE cust_id = ?",
        rowMapper,
        custId);

// Spring Data derived query: parameters are bound, not concatenated
Optional<Account> findByCustId(String custId);

// Named parameter JPQL
@Query("select a from Account a where a.custId = :custId")
Optional<Account> findOne(@Param("custId") String custId);
```

For XSS, keep output encoding in the template layer, set correct content types for APIs, and use a tight Content Security Policy where it fits the app.

### Mitigations

- Prefer parameterized APIs and ORMs; never concatenate untrusted input into SQL or commands.
- Validate on the server with allowlists where you can.
- Escape only as a backup for a specific interpreter; do not treat escaping as the primary control.
- For commands, avoid shells; pass argument lists without going through `sh -c`.
- Add SAST/DAST in CI for high-risk inputs (search boxes, report filters, admin tools).
- Remember that stored procedures are not automatically safe if they concatenate SQL inside the procedure body.

## A06 Insecure Design

**Insecure design** is a missing or weak security control in the product design itself. Secure implementation cannot fix a flow that was never threat modeled. Examples include password reset links that never expire, invitations that allow privilege escalation, or business workflows with no abuse limits.

OWASP introduced this category in 2021. It remains in the 2025 list, a bit lower in rank as misconfiguration and supply chain moved up, but the design work is still required.

### How Attacks Look

- Brute force a short numeric reset code with no rate limit or lockout.
- Abuse a checkout flow that never reconciles inventory and payment.
- Enumerate accounts through a registration endpoint that reveals whether an email exists, then chain that into password spraying.
- Use a multi-tenant feature that isolates tenants in the UI only.

### Concrete Example

A "transfer between wallets" API allows unlimited retries with no velocity check and no step-up authentication. Even if each code path is tidy, the design invites automated abuse.

### Mitigations

- Threat model new features before coding them.
- Write explicit abuse cases next to user stories.
- Enforce business limits in the domain layer (quotas, velocity checks, dual control for sensitive actions).
- Use proven patterns for authn, session, and multi-tenant isolation.
- Review designs against OWASP ASVS or a similar baseline.
- Revisit old flows when the business model changes; yesterday's low-risk endpoint can become high-risk.

Insecure design is not "the code has a bug." It is "the system allows a bad outcome even when the code matches the design."

## A07 Authentication Failures

**Authentication Failures** (renamed from Identification and Authentication Failures) cover weak login, session fixation, credential stuffing success, missing multi-factor authentication for high-risk actions, and poor recovery flows. Broader use of standard frameworks has helped, but custom shortcuts still create holes.

### How Attacks Look

- Stuff breached username/password pairs against `/login`.
- Keep using a session cookie that was never rotated after login.
- Reset a password with a predictable or reusable token.
- Bypass MFA on an alternate "legacy" endpoint that still accepts passwords alone.
- Exploit "remember me" tokens that never expire and are stored insecurely.

### Concrete Example

A user logs in over HTTPS, but the session identifier from the anonymous browsing phase is kept. An attacker who planted that session earlier inherits the authenticated session. Session fixation defenses exist specifically to stop that class of bug.

### Vulnerable vs Fixed (Spring Security)

```java
// Vulnerable custom choice: session id reused across privilege change
http.sessionManagement(session -> session
        .sessionFixation(sessionFixation -> sessionFixation.none()));
```

```java
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http.sessionManagement(session -> session
            .sessionFixation(sessionFixation -> sessionFixation.changeSessionId()));
    http.formLogin(Customizer.withDefaults());
    return http.build();
}
```

### Mitigations

- Use the framework's authentication stack; avoid hand-rolled crypto for sessions.
- Rotate session identifiers on login.
- Rate-limit authentication and recovery endpoints.
- Require MFA for privileged accounts and sensitive operations.
- Store passwords only with a strong password encoder.
- Prefer well-tested OIDC/OAuth integrations for delegated login.
- Invalidate sessions server-side on logout and on password change.

## A08 Software or Data Integrity Failures

**Software or Data Integrity Failures** focus on trust boundaries for code and data artifacts: unsigned updates, insecure CI artifacts, auto-updating without verification, and unsafe deserialization of untrusted data. This sits close to supply chain issues, but lower in the stack: verifying what you run and what you accept once it arrives.

### How Attacks Look

- Deserialize a Java object stream from a cookie or queue message and trigger gadget code.
- Deploy a container image that was retagged by an attacker in a writable registry.
- Accept a webhook body as trusted configuration without signature checks.
- Auto-update a client from HTTP without signature verification.

### Concrete Example

An app consumes messages from a queue and reconstructs Java objects with native serialization. An attacker who can publish to that queue sends a crafted payload. Integrity was assumed because the queue was "internal," but the trust boundary was wrong.

### Mitigations

- Prefer data formats that do not execute code during parsing.
- Avoid Java native serialization for untrusted input; use JSON with explicit DTOs.
- Sign and verify build artifacts; promote the same artifact across environments.
- Protect package publish tokens; use short-lived credentials in CI.
- Verify webhook signatures before applying side effects.
- Treat "internal network" as hostile unless authenticated and authorized.

```java
// Prefer explicit DTOs over ObjectInputStream for untrusted payloads
@PostMapping("/hooks/billing")
public ResponseEntity<Void> hook(@RequestBody BillingEvent event,
                                 @RequestHeader("X-Signature") String signature) {
    verifier.verify(event, signature);
    billingHandler.apply(event);
    return ResponseEntity.ok().build();
}
```

## A09 Security Logging and Alerting Failures

**Security Logging and Alerting Failures** cover missing logs, logs that cannot be used in an investigation, and alerts that never fire. OWASP renamed the category to stress **alerting**: great logs with no response path still leave you blind during an incident.

This category is often underrepresented in scanner data. Teams vote it into the list because investigations fail without evidence, and detections fail without alerts.

### How Attacks Look

- An attacker sprays passwords for hours; nobody notices because failures are not aggregated.
- Logs contain session tokens, then leak through a support export.
- Audit events go only to local disk on an ephemeral container that disappears after a crash.
- Alerts exist but route to a dead email list.

### Concrete Example

Access control denials return HTTP 403 correctly, yet nothing logs the principal, object id, or route. Weeks later you cannot tell whether a breach attempt was systematic or a one-off typo.

### Mitigations

- Log authentication failures, access control failures, and admin actions.
- Keep enough context (who, what, when, where) without logging secrets or raw passwords.
- Ship logs to a durable, access-controlled store.
- Alert on repeated failures, impossible travel patterns, and privilege changes.
- Test that alerts reach humans who can act.
- Protect log integrity and access; logs are sensitive data too.

```java
if (!accessService.canRead(user, order)) {
    securityLog.warn("access_denied user={} order={}", user.id(), order.id());
    throw new AccessDeniedException("Forbidden");
}
```

## A10 Mishandling of Exceptional Conditions

**Mishandling of Exceptional Conditions** is new in 2025. It covers improper error handling, logical errors, failing open, leaking sensitive details in errors, ignoring unusual states, and leaving transactions or resources half-applied. Notable CWEs include **CWE-209** (error message information leak), **CWE-476** (NULL pointer dereference), and **CWE-636** (failing open).

### How Attacks Look

- Force errors to harvest stack traces and SQL text for a later injection.
- Interrupt a multi-step money flow so debit succeeds and credit never rolls back.
- Exhaust resources because exceptions skip cleanup.
- Hit a feature that fails open when a policy service is down, granting access by accident.

### Concrete Example

A transfer API debits wallet A, then credits wallet B. A timeout hits after the debit. The handler swallows the exception and returns success to the client. Without a surrounding transaction and a fail-closed policy, money disappears or can be replayed into a messy state.

### Vulnerable vs Fixed

```java
// Vulnerable: exposes nothing useful to operators and may leave partial work
@PostMapping("/transfer")
public void transfer(@RequestBody TransferRequest request) {
    try {
        ledger.debit(request.from(), request.amount());
        ledger.credit(request.to(), request.amount());
    } catch (Exception ex) {
        return;
    }
}
```

```java
@PostMapping("/transfer")
@Transactional
public void transfer(@RequestBody TransferRequest request) {
    ledger.debit(request.from(), request.amount());
    ledger.credit(request.to(), request.amount());
}

@ControllerAdvice
class ApiErrors {
    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handle(Exception ex) {
        log.error("request_failed", ex);
        return ResponseEntity.status(500)
                .body(new ApiError("request_failed", "Unexpected error"));
    }
}
```

### Mitigations

- Fail closed for authorization and money movement when dependencies fail.
- Use transactions so partial updates roll back together.
- Catch errors where you can recover; use a global handler for the rest.
- Return generic client messages; keep detail in logs.
- Add rate limits and quotas so resource exhaustion is harder.
- Release resources in finally blocks or try-with-resources.
- Treat repeated identical errors as a signal for A09 alerting.

## Mitigation Checklist

| Category | First Controls to Put in Place |
|---|---|
| A01 Access Control | Deny by default, server-side checks, ownership rules, SSRF allowlists |
| A02 Misconfiguration | Hardened baselines, locked actuators, no prod stack traces |
| A03 Supply Chain | SBOM, SCA in CI, pinned deps, hardened pipelines |
| A04 Crypto | TLS, strong password hashing, managed keys |
| A05 Injection | Parameterized queries, output encoding, no shell concatenation |
| A06 Insecure Design | Threat models, abuse cases, business limits |
| A07 Authentication | Framework auth, session rotation, MFA, rate limits |
| A08 Integrity | Signed artifacts, safe parsers, verified webhooks |
| A09 Logging and Alerting | Security events, durable logs, tested alerts |
| A10 Exceptional Conditions | Fail closed, transactional rollback, safe error pages |

## Step by Step Adoption Plan

1. Map your app's trust boundaries: users, admins, internal services, outbound HTTP.
2. Score current exposure against the 2025 ten categories; fix open A01 and A05 issues on internet-facing surfaces first.
3. Turn on dependency scanning and secret scanning in every repo.
4. Centralize authentication and authorization with Spring Security instead of scattered `if` checks.
5. Add security logging and one or two high-signal alerts before you build a large SIEM project.
6. Revisit design reviews for money movement, file import, and URL-fetching features.
7. Practice incident response with a tabletop that assumes a dependency compromise.
8. Re-read the official OWASP pages for any category that maps to your highest business impact flows.

## Common Mistakes

- Treating the Top 10 as a compliance finish line instead of an awareness baseline.
- Putting access checks only in the front end.
- Concatenating untrusted input into SQL, HQL, or shell commands "just for an admin tool."
- Leaving actuator and default credentials enabled outside local development.
- Logging passwords, tokens, or full cardholder data.
- Failing open when an entitlement service times out.
- Tracking direct dependencies only and ignoring the transitive graph.
- Collecting logs with no alert path and calling that "monitoring."

## Conclusion

OWASP Top 10:2025 keeps Broken Access Control at the top, elevates misconfiguration and supply chain risk, folds SSRF into access control, renames authentication and logging categories for clarity, and adds Mishandling of Exceptional Conditions. The list is an awareness tool, not a complete standard. Use it to prioritize, then deepen controls with ASVS, cheat sheets, and your own threat models.

For Spring Boot teams, most progress comes from a small set of habits: parameterized data access, server-side authorization, safe defaults in config, verified dependencies and artifacts, and errors that fail closed without leaking internals. Start with the checklist, fix the paths attackers can already reach, and treat the Top 10 as a living review lens rather than a one-time audit form.
