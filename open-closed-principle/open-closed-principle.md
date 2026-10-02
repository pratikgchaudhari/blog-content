---
title: The Open-Closed Principle in Java
date: 2026-10-02
summary: What it is & how to implement it in real-world use cases
tag: Java
draft: false
---

Software entities should be open for extension and closed for modification. Bertrand Meyer named the idea in 1988; Robert C. Martin later made it the O in SOLID.

Open means a new behavior can be added. Closed means that addition does not require editing code clients already depend on. The two fit together when the variation sits behind an abstraction.

## The smell

A discount calculator that learns every customer type:

```java
public class DiscountCalculator {

    public double discountFor(Order order) {
        return switch (order.customerType()) {
            case "REGULAR" -> order.amount() * 0.05;
            case "PREMIUM" -> order.amount() * 0.15;
            default -> 0.0;
        };
    }
}
```

Employee, festival, and loyalty discounts each add a branch. The class is open for modification and closed for extension. Every tested caller is at risk, and the calculator knows every pricing policy in the company. The same shape is a growing `switch`, a chain of `instanceof`, or `if (channel == WHATSAPP)`.

## The fix

Extract the varying behavior. New discounts are new classes. The calculator is not edited.

```java
public interface DiscountPolicy {
    double discountFor(Order order);
}

public final class PremiumDiscount implements DiscountPolicy {
    @Override
    public double discountFor(Order order) {
        return order.amount() * 0.15;
    }
}

public class DiscountCalculator {

    private final DiscountPolicy policy;

    public DiscountCalculator(DiscountPolicy policy) {
        this.policy = policy;
    }

    public double discountFor(Order order) {
        return policy.discountFor(order);
    }
}
```

A festival discount is a new `FestivalDiscount` wired in at the edge. This is the Strategy pattern, the usual form of OCP in Java services.

Selection of the policy belongs in configuration or the composition root, not in the pricing rules. In Spring, policies can register themselves:

```java
@Component
public class DiscountPolicyRegistry {

    private final Map<String, DiscountPolicy> policies;

    public DiscountPolicyRegistry(List<DiscountPolicy> discovered) {
        this.policies = discovered.stream()
            .collect(Collectors.toUnmodifiableMap(DiscountPolicy::code, p -> p));
    }

    public DiscountPolicy get(String code) {
        return Optional.ofNullable(policies.get(code))
            .orElseThrow(() -> new UnknownDiscountException(code));
    }
}
```

A new `@Component` that implements `DiscountPolicy` is injected via `List<DiscountPolicy>`. The registry is not edited.

## What closed does not mean

Bug fixes and renames still edit existing classes. OCP is about behavioral extension: a new discount, report format, or payment provider.

A stable two-branch `if` is not a design failure. Extract an abstraction only when the set of variants is already growing, the branches are different business policies, or callers must supply their own variant. Otherwise the interface is ceremony.
