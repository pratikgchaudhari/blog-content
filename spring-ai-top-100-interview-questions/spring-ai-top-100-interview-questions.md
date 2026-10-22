---
title: Top 100 Spring AI Interview Questions and Answers
date: 2026-10-22
summary: Concise Q&A covering Spring AI fundamentals, ChatClient, RAG, tool calling, advisors, vector stores, MCP, and production concerns for Java developers.
tag: spring-ai, interview-questions, java, rag, genai, mcp
draft: false
---

## Fundamentals

**1. What is Spring AI?**  
Spring AI is the official Spring portfolio project that provides portable, production-ready abstractions for integrating LLMs, embeddings, vector stores, and tools into Spring Boot applications.

**2. What problem does Spring AI solve?**  
It eliminates vendor lock-in and boilerplate by giving a single API (`ChatClient`, `VectorStore`, etc.) so you can swap providers (OpenAI, Anthropic, Azure, Ollama, Bedrock) via configuration.

**3. How does Spring AI differ from calling an LLM SDK directly?**  
It adds Spring Boot auto-configuration, advisors (memory, RAG, logging), structured output, tool calling, observability, and a fluent API while remaining provider-agnostic.

**4. Spring AI vs LangChain4j â key differences?**  
Spring AI is the official Spring abstraction layer, tightly integrated with Boot and lighter for Spring shops. LangChain4j is a fuller independent framework with richer agent/RAG primitives but less native Spring integration.

**5. What are the main components of Spring AI?**  
ChatModel/ChatClient, EmbeddingModel, VectorStore, Advisors, Tool calling, Document ETL, PromptTemplate, and MCP support.

**6. Which model types does Spring AI support?**  
Chat, Embedding, Image generation, Audio transcription, and Text-to-Speech.

**7. How do you start a Spring AI project?**  
Use start.spring.io with the desired model starter (e.g., `spring-ai-starter-model-openai`) and optional vector-store starter.

## ChatClient and ChatModel

**8. What is the difference between ChatModel and ChatClient?**  
`ChatModel` is the low-level provider interface (`call(Prompt)`). `ChatClient` is the high-level fluent API that adds defaults, advisors, tools, and structured output.

**9. How do you create a ChatClient?**  
`ChatClient.create(chatModel)` or `ChatClient.builder(chatModel).defaultSystem(...).defaultAdvisors(...).build()`.

**10. What is the typical ChatClient call flow?**  
`chatClient.prompt().system(...).user(...).options(...).call().content()` or `.entity(MyRecord.class)`.

**11. How do you stream responses?**  
Use `.stream()` instead of `.call()` to get a `Flux<String>` (or full response).

**12. What are default system prompts and options on ChatClient?**  
Set via builder (`defaultSystem`, `defaultOptions`) so every request inherits them; per-request methods override.

**13. How do you access token usage?**  
Call `.chatResponse()` and inspect `Usage` from the metadata.

**14. Can you have multiple ChatClients?**  
Yes. Create different beans with different defaults, advisors, or models for different use cases.

## Prompts and Messages

**15. What message roles does Spring AI support?**  
System, User, Assistant, and Tool (function) response messages.

**16. Difference between system and user messages?**  
System sets behavior/instructions; user contains the actual query or task.

**17. What is a PromptTemplate?**  
A string template with placeholders that you render with parameters before sending to the model.

**18. How does PromptTemplate work?**  
`new PromptTemplate("Hello {name}").create(Map.of("name", "World"))` produces a Prompt.

**19. Why use PromptTemplate over string concatenation?**  
Cleaner, reusable, and safer for dynamic values.

**20. What is the difference between a Prompt and a ChatClient prompt chain?**  
Prompt is the low-level message list; ChatClient builds and enriches it via advisors and fluent methods.

## Structured Output

**21. What is structured output in Spring AI?**  
Mapping the modelâs text response into a Java type (record, POJO, or Map) via `.entity(Class)`.

**22. How does structured output work internally?**  
Spring AI instructs the model (via system prompt or function calling) to return JSON matching the target typeâs schema, then deserializes it.

**23. Example of structured output?**  
`chatClient.prompt().user("Extract order").call().entity(Order.class)`.

**24. What happens if the model returns invalid JSON?**  
Deserialization fails; you can fall back to raw content or retry with better prompting.

**25. Can you use records with structured output?**  
Yes â records are the recommended approach for immutable structured responses.

## Advisors

**26. What are Advisors in Spring AI?**  
Interceptors in the ChatClient chain that can transform requests/responses (memory, RAG, logging, safety, tool calling).

**27. Name the main built-in Advisors.**  
MessageChatMemoryAdvisor, QuestionAnswerAdvisor, RetrievalAugmentationAdvisor, ToolCallingAdvisor, SafeGuardAdvisor, SimpleLoggerAdvisor.

**28. How do you register Advisors?**  
`.defaultAdvisors(...)` on the builder or `.advisors(...)` per request. Order is controlled by `Ordered` values.

**29. What is MessageChatMemoryAdvisor?**  
Adds previous conversation messages to the prompt and stores the new exchange in a ChatMemory store.

**30. What is QuestionAnswerAdvisor?**  
Classic RAG advisor: embeds the question, searches VectorStore, injects retrieved documents into the prompt.

**31. QuestionAnswerAdvisor vs RetrievalAugmentationAdvisor?**  
QuestionAnswerAdvisor is the simple out-of-the-box RAG. RetrievalAugmentationAdvisor is the modular, extensible RAG pipeline (retriever, transformer, etc.).

**32. What is ToolCallingAdvisor?**  
Manages the multi-turn tool-calling loop (model requests tool â execute â send result back) inside the ChatClient chain (centralized in Spring AI 2.x).

**33. Can you write a custom Advisor?**  
Yes â implement CallAdvisor / StreamAdvisor and add it to the chain.

**34. How does Advisor order work?**  
Lower order values run first. Memory and tool advisors usually run before RAG.

## Chat Memory

**35. Why does a chatbot need memory?**  
Without it every request is stateless; the model cannot refer to earlier turns.

**36. What is ChatMemory?**  
An interface that stores and retrieves conversation messages (in-memory, JDBC, Redis, etc.).

**37. MessageChatMemoryAdvisor vs VectorStoreChatMemoryAdvisor?**  
Message version injects raw messages; VectorStore version embeds history and retrieves relevant past turns semantically.

**38. How do you pass a conversation ID?**  
`.advisors(a -> a.param(ChatMemory.CONVERSATION_ID, id))`.

**39. What is the risk of unbounded memory?**  
Token limits and cost. Limit history size or summarize older turns.

## Embeddings and Vector Stores

**40. What is an embedding?**  
A dense vector (list of floats) that captures semantic meaning so similar texts are close in vector space.

**41. What is cosine similarity?**  
A measure of the angle between two vectors; 1.0 = identical direction, 0 = orthogonal.

**42. Why must the same embedding model be used for ingestion and query?**  
Different models produce incompatible vector spaces; similarity search would be meaningless.

**43. What is a VectorStore?**  
A store that persists Documents together with their embeddings and supports similarity search + metadata filtering.

**44. Name common VectorStore implementations.**  
SimpleVectorStore (in-memory), PgVector, Redis, Elasticsearch, Pinecone, Qdrant, Milvus, Weaviate, Chroma, Neo4j, MongoDB Atlas.

**45. How do you perform a similarity search?**  
`vectorStore.similaritySearch(SearchRequest.builder().query(q).topK(5).similarityThreshold(0.7).build())`.

**46. What is metadata filtering?**  
SQL-like expressions (`eq`, `in`, `and`, `or`) to restrict search to documents matching attributes (department, date, etc.).

**47. What is SimpleVectorStore good for?**  
Tests and prototypes only; not durable or scalable for production.

## RAG (Retrieval-Augmented Generation)

**48. Explain RAG in one sentence.**  
Retrieve relevant document chunks via embeddings, inject them into the prompt, then generate an answer grounded in that context.

**49. What are the two main RAG flows?**  
Ingestion (load â split â embed â store) and Query (embed question â retrieve â augment prompt â generate).

**50. Why is document chunking necessary?**  
Models have context-window limits; small chunks improve retrieval precision.

**51. What is TokenTextSplitter?**  
A splitter that divides text by approximate token count rather than characters.

**52. Name DocumentReaders provided by Spring AI.**  
TextReader, JsonReader, MarkdownReader, PDF readers (via Tika or dedicated), etc.

**53. What is the Document class?**  
Holds content, metadata, and (optionally) embedding for a chunk.

**54. How does QuestionAnswerAdvisor implement RAG?**  
On each request it searches the VectorStore and appends matching documents to the user message (or system context).

**55. Common RAG failure modes?**  
Wrong embedding model, poor chunking, low similarity threshold, missing metadata filters, context overflow, or the model ignoring the retrieved context.

**56. How do you improve RAG quality?**  
Better chunking, hybrid search, re-ranking, query rewriting, metadata filters, and evaluation of retrieval precision.

**57. What is RetrievalAugmentationAdvisor?**  
Modular RAG advisor that lets you plug in custom retrievers, query transformers, and document post-processors.

## Tool Calling / Function Calling

**58. What is tool calling (function calling)?**  
The model decides it needs external data or an action, emits a structured tool request, your code executes it, and the result is sent back for the final answer.

**59. How do you expose a method as a tool?**  
Annotate it with `@Tool` (or implement `Function`) and register the bean with the ChatClient (`.tools(...)` or `.defaultTools(...)`).

**60. Example of a @Tool method?**  
```java
@Tool(description = "Get current weather")
public String getWeather(@ToolParam(description = "City") String city) { ... }
```

**61. How does the tool-calling loop work in Spring AI 2.x?**  
ToolCallingAdvisor (inside ChatClient) repeatedly calls the model, executes requested tools, and continues until the model produces a final answer.

**62. What changed with tool calling in Spring AI 2.0?**  
Execution moved from individual ChatModel implementations into a unified ToolCallingAdvisor in the ChatClient chain for consistency across providers.

**63. Can tools have side effects?**  
Yes, but prefer read-only tools; guard mutating tools with confirmation or authorization.

**64. How do you limit which tools the model sees?**  
Pass only the relevant tool instances per request or use tool discovery features.

**65. What is the risk of too many tools?**  
Larger prompts, higher cost, and poorer tool selection accuracy.

## MCP (Model Context Protocol)

**66. What is MCP?**  
An open protocol that standardizes how AI applications discover and call external tools, resources, and prompts.

**67. How does Spring AI support MCP?**  
Via dedicated Boot starters for MCP clients and servers, plus `@McpTool`, `@McpResource`, `@McpPrompt` annotations.

**68. Difference between @Tool and @McpTool?**  
`@Tool` is for in-process Spring AI tool calling; `@McpTool` exposes the method over the MCP protocol so external clients/servers can use it.

**69. What transports does Spring AI MCP support?**  
STDIO, SSE, Streamable-HTTP, and stateless HTTP variants (WebMVC and WebFlux).

**70. Why use MCP?**  
To share tools across different AI clients and languages in a standard way instead of custom integrations.

## Streaming, Options, and Providers

**71. How do you switch model providers?**  
Change the starter dependency and configuration properties (API key, base URL, model name). Application code stays the same.

**72. What are ChatOptions?**  
Provider-specific settings (temperature, max tokens, top-p, model name) passed via `.options(...)`.

**73. How do you set temperature?**  
`OpenAiChatOptions.builder().temperature(0.2).build()` or the equivalent for the provider.

**74. Which providers are commonly supported?**  
OpenAI, Azure OpenAI, Anthropic, Google Gemini, Amazon Bedrock, Ollama, Hugging Face, Mistral, etc.

**75. What is Ollama useful for?**  
Running open-weight models locally for development or air-gapped environments.

## Production, Security, and Observability

**76. How do you secure API keys?**  
Never hard-code them; use environment variables, Spring Cloud Config, or a secret manager.

**77. What is prompt injection?**  
Malicious user or retrieved content that tries to override system instructions. Mitigate with input validation, output filtering, least-privilege tools, and monitoring.

**78. How does Spring AI integrate with observability?**  
Micrometer metrics for token usage, latency, and errors; advisors can add custom tracing.

**79. How do you test Spring AI code?**  
Use testcontainers or mocked ChatModel; verify advisors, structured output, and tool execution with unit/integration tests.

**80. What changes when deploying to Kubernetes?**  
Usual Spring Boot concerns plus secret management, rate limiting, horizontal scaling of stateless ChatClients, and careful memory/token budgeting.

**81. How do you control cost?**  
Limit max tokens, use cheaper models for simple tasks, cache embeddings, set similarity thresholds, and monitor usage.

**82. What is SafeGuardAdvisor?**  
A simple advisor that blocks requests containing forbidden words before they reach the model.

## Advanced and Edge Cases

**83. What happens when the context window is exceeded?**  
The provider returns an error. Mitigate by truncating history, summarizing, or reducing retrieved chunks.

**84. How do you handle rate limits?**  
Retry with exponential backoff, use provider-specific rate-limit headers, or queue requests.

**85. Can you use virtual threads with Spring AI?**  
Yes. Spring Boot 3+ and virtual threads work well for the blocking I/O of model calls.

**86. What is the ETL framework in Spring AI?**  
DocumentReader â DocumentTransformer (splitter) â DocumentWriter (VectorStore) pipeline for ingestion.

**87. How do you update or delete documents in a VectorStore?**  
Use metadata filters to identify them, then `delete` and re-`add`. Some stores support upsert by ID.

**88. What is hybrid search?**  
Combining vector similarity with keyword/BM25 search for better recall.

**89. How do you evaluate RAG quality?**  
Precision/recall of retrieval, faithfulness of answers to context, and human or LLM-as-judge scoring.

**90. Difference between Spring AI 1.x and 2.x?**  
2.x unifies tool calling in the advisor chain, improves MCP, adds message parts, and targets newer Spring Boot versions.

## Scenario and Best-Practice Questions

**91. Design a document Q&A service.**  
Ingestion job (PDF/Markdown â split â embed â PgVector), ChatClient with QuestionAnswerAdvisor + memory, REST endpoint, metadata filters by tenant.

**92. How would you implement multi-tenant RAG?**  
Store tenant ID in document metadata and always apply a filter expression on search.

**93. When should you not use RAG?**  
When the knowledge is already in the modelâs training data, the dataset is tiny, or latency/cost constraints are extreme.

**94. How do you implement an agent that can call multiple tools?**  
Register several `@Tool` methods; let ToolCallingAdvisor handle the loop; add confirmation for destructive actions.

**95. How do you add conversation summarization?**  
Periodically summarize older messages and replace them in ChatMemory to stay within token limits.

**96. What is the recommended way to handle structured extraction?**  
Use `.entity(Record.class)` with a clear system prompt that describes the desired schema.

**97. How do you make RAG answers cite sources?**  
Include document metadata (filename, page) in the retrieved context and instruct the model to reference it.

**98. What logging should you add?**  
SimpleLoggerAdvisor or custom advisor that logs prompt, retrieved docs, tool calls, and token usage (redact secrets).

**99. How do you version prompts?**  
Store PromptTemplates in configuration or a database so they can be updated without code changes.

**100. Key production checklist for a Spring AI service?**  
Secrets management, rate limiting, observability, evaluation suite, fallback model, token budgets, prompt-injection defenses, and clear ownership of the VectorStore data lifecycle.