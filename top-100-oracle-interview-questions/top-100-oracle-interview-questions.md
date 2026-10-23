---
title: Top 100 Oracle Database Interview Questions and Answers
date: 2026-10-23
summary: Concise list of the top 100 Oracle Database interview questions with short, crisp answers for quick preparation.
tag: Oracle, Database, SQL, PL/SQL, Interview
draft: false
---

1. **What is Oracle Database?**  
   A multi-model relational database management system (RDBMS) from Oracle Corporation used for storing, managing, and retrieving structured data.

2. **Difference between CHAR and VARCHAR2?**  
   CHAR is fixed-length and pads with spaces; VARCHAR2 is variable-length and stores only the actual data (more efficient for variable strings).

3. **What is a primary key?**  
   A column or set of columns that uniquely identifies each row in a table. It cannot contain NULL values and must be unique.

4. **What is a foreign key?**  
   A column that references the primary key of another table to enforce referential integrity.

5. **Difference between DELETE and TRUNCATE?**  
   DELETE removes rows one by one (can be rolled back, fires triggers); TRUNCATE removes all rows instantly (DDL, cannot be rolled back, faster, resets high-water mark).

6. **Difference between DROP and TRUNCATE?**  
   DROP removes the entire table structure and data; TRUNCATE removes only the data but keeps the structure.

7. **What is an index?**  
   A data structure that improves the speed of data retrieval operations on a table at the cost of additional storage and slower writes.

8. **Types of indexes in Oracle?**  
   B-tree, Bitmap, Function-based, Reverse key, Domain, Cluster, and Invisible indexes.

9. **What is a unique index?**  
   An index that enforces uniqueness on the indexed column(s); similar to a unique constraint.

10. **What is a view?**  
    A virtual table based on the result of a SQL query. It does not store data physically (except materialized views).

11. **Difference between simple and complex view?**  
    Simple view is based on one table and allows DML; complex view joins multiple tables or uses functions and usually does not allow DML.

12. **What is a materialized view?**  
    A view that stores the query result physically and can be refreshed periodically for better performance.

13. **What is a sequence?**  
    A database object that generates unique numeric values, commonly used for primary keys.

14. **What is a synonym?**  
    An alias for a table, view, sequence, or other object, used to simplify access or hide the original object name.

15. **What is PL/SQL?**  
    Procedural Language extension to SQL that allows writing blocks of code with variables, conditions, loops, and error handling.

16. **Difference between SQL and PL/SQL?**  
    SQL is declarative and used for querying/manipulating data; PL/SQL is procedural and used for writing application logic, procedures, and triggers.

17. **What is a cursor?**  
    A pointer to a memory area (private SQL area) that holds the result set of a SQL statement for row-by-row processing.

18. **Types of cursors?**  
    Implicit cursors (automatically created by Oracle) and Explicit cursors (declared by the programmer).

19. **What is %TYPE and %ROWTYPE?**  
    %TYPE inherits the data type of a column or variable; %ROWTYPE inherits the structure of a table or cursor row.

20. **What is a trigger?**  
    A stored procedure that automatically executes in response to certain events on a table or view (INSERT, UPDATE, DELETE).

21. **Types of triggers?**  
    BEFORE/AFTER, ROW-level/STATEMENT-level, INSTEAD OF (for views), and Compound triggers.

22. **What is a package?**  
    A schema object that groups related procedures, functions, variables, and cursors into a single unit with a specification and body.

23. **Advantage of packages?**  
    Modularity, information hiding, better performance (loaded once), and overloading of subprograms.

24. **What is an exception?**  
    An error condition that occurs during program execution. Oracle provides predefined exceptions and allows user-defined ones.

25. **Common predefined exceptions?**  
    NO_DATA_FOUND, TOO_MANY_ROWS, ZERO_DIVIDE, DUP_VAL_ON_INDEX, INVALID_CURSOR, VALUE_ERROR.

26. **What is the difference between procedure and function?**  
    Procedure does not return a value (or returns via OUT parameters); Function must return a single value and can be used in SQL statements.

27. **What is a collection in PL/SQL?**  
    A data structure that holds multiple elements of the same type: Associative arrays, Nested tables, and VARRAYs.

28. **What is bulk collect?**  
    A method to fetch multiple rows at once into a collection, improving performance by reducing context switches.

29. **What is FORALL?**  
    A bulk bind statement that executes DML statements for all elements in a collection efficiently.

30. **What is the SGA?**  
    System Global Area — a shared memory region that contains data and control information for the Oracle instance (shared pool, buffer cache, redo log buffer, etc.).

31. **What is the PGA?**  
    Program Global Area — private memory region for each server process, containing sort areas, session information, and cursor state.

32. **What is a tablespace?**  
    A logical storage unit that groups related data files. Tables and indexes are stored in tablespaces.

33. **What is a data file?**  
    A physical file on disk that stores the actual data of a tablespace.

34. **What is a control file?**  
    A binary file that records the physical structure of the database (data file names, redo log locations, SCN, etc.).

35. **What is a redo log?**  
    Files that record all changes made to the database for recovery purposes. Written circularly.

36. **What is undo?**  
    Information that allows rollback of transactions and provides read consistency. Stored in undo tablespaces.

37. **What is a checkpoint?**  
    An event that writes dirty buffers from the buffer cache to data files and updates the control file and data file headers with the SCN.

38. **What is SCN?**  
    System Change Number — a logical timestamp that uniquely identifies a committed version of the database.

39. **What is the difference between instance and database?**  
    Database is the set of physical files; Instance is the set of memory structures (SGA) and background processes that manage the database.

40. **What are background processes?**  
    Processes that perform maintenance tasks: DBWn, LGWR, CKPT, SMON, PMON, ARCn, etc.

41. **What does DBWn do?**  
    Database Writer process writes dirty buffers from the buffer cache to data files.

42. **What does LGWR do?**  
    Log Writer process writes redo log buffer entries to online redo log files.

43. **What is a transaction?**  
    A logical unit of work that consists of one or more SQL statements. It ends with COMMIT or ROLLBACK.

44. **What is ACID?**  
    Atomicity, Consistency, Isolation, Durability — properties that guarantee reliable database transactions.

45. **What is isolation level?**  
    Defines how transactions interact: READ COMMITTED (Oracle default), SERIALIZABLE, READ ONLY.

46. **What is a deadlock?**  
    A situation where two or more sessions are waiting for each other to release locks, resulting in a circular wait. Oracle detects and resolves them.

47. **What is a latch?**  
    A low-level serialization mechanism that protects shared memory structures in the SGA. Short-duration locks.

48. **What is a lock?**  
    A mechanism that prevents concurrent transactions from modifying the same data simultaneously.

49. **What is row-level locking?**  
    Oracle locks only the rows being modified, allowing high concurrency.

50. **What is a join?**  
    A query that combines rows from two or more tables based on a related column.

51. **Types of joins?**  
    Inner join, Left/Right/Full outer join, Cross join, Self join, Natural join.

52. **What is a subquery?**  
    A query nested inside another SQL statement. Can be single-row, multi-row, or correlated.

53. **What is a correlated subquery?**  
    A subquery that references columns from the outer query and is executed once per outer row.

54. **What is an analytic function?**  
    Functions that perform calculations across a set of rows related to the current row (e.g., RANK, ROW_NUMBER, LAG, LEAD, SUM OVER).

55. **Difference between RANK and DENSE_RANK?**  
    RANK leaves gaps after ties; DENSE_RANK does not leave gaps.

56. **What is PARTITION BY?**  
    Clause used with analytic functions to divide the result set into partitions for calculation.

57. **What is a constraint?**  
    A rule that enforces data integrity: PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK, NOT NULL.

58. **What is a check constraint?**  
    A constraint that ensures values in a column satisfy a specified condition.

59. **What is normalization?**  
    Process of organizing data to reduce redundancy and improve data integrity (1NF, 2NF, 3NF, BCNF).

60. **What is denormalization?**  
    Intentionally introducing redundancy to improve query performance.

61. **What is the cost-based optimizer (CBO)?**  
    The optimizer that chooses the execution plan based on statistics about data distribution and cost estimates.

62. **What is an execution plan?**  
    The sequence of operations Oracle performs to execute a SQL statement. Viewed with EXPLAIN PLAN or DBMS_XPLAN.

63. **What is a hint?**  
    A directive to the optimizer to influence the execution plan (e.g., /*+ INDEX(t idx) */).

64. **What is bind variable peeking?**  
    When the optimizer looks at the actual value of a bind variable during hard parse to generate a plan.

65. **What is adaptive cursor sharing?**  
    Feature that allows Oracle to generate multiple plans for the same SQL with different bind values.

66. **What is the high water mark?**  
    The boundary between used and unused space in a segment. TRUNCATE resets it; DELETE does not.

67. **What is row migration and chaining?**  
    Migration: row is moved because it no longer fits in the original block after update. Chaining: row is too large to fit in one block.

68. **What is PCTFREE and PCTUSED?**  
    PCTFREE reserves space in a block for future updates; PCTUSED determines when a block is eligible for new inserts.

69. **What is a cluster?**  
    A schema object that stores related rows from multiple tables in the same data blocks based on a common key.

70. **What is a hash cluster?**  
    A cluster that uses a hash function to store and retrieve rows, ideal for equality lookups.

71. **What is partitioning?**  
    Dividing a large table or index into smaller, more manageable pieces (range, list, hash, composite).

72. **Benefits of partitioning?**  
    Improved performance, easier maintenance, and better manageability of large tables.

73. **What is parallel query?**  
    Executing a single SQL statement using multiple processes to improve performance on large data sets.

74. **What is the result cache?**  
    A memory area in the SGA that stores results of SQL queries or PL/SQL functions for reuse.

75. **What is flashback technology?**  
    Features that allow viewing or recovering past data: Flashback Query, Flashback Table, Flashback Database, etc.

76. **What is RMAN?**  
    Recovery Manager — Oracle’s tool for backup and recovery of the database.

77. **What is a full backup vs incremental backup?**  
    Full backup copies all data blocks; Incremental backup copies only blocks changed since the last backup.

78. **What is archive log mode?**  
    Mode in which redo logs are archived before being overwritten, enabling point-in-time recovery.

79. **What is a data dictionary?**  
    A set of read-only tables and views that contain metadata about the database (owned by SYS).

80. **What is DUAL table?**  
    A special one-row, one-column table owned by SYS, used for selecting expressions or calling functions.

81. **What is NVL and NVL2?**  
    NVL replaces NULL with a specified value; NVL2 returns one value if not null and another if null.

82. **What is COALESCE?**  
    Returns the first non-null expression from a list of expressions.

83. **What is DECODE vs CASE?**  
    DECODE is an older Oracle-specific function; CASE is ANSI-standard and more flexible.

84. **What is MERGE statement?**  
    Combines INSERT, UPDATE, and DELETE operations in a single statement based on a condition.

85. **What is a global temporary table?**  
    A table whose data is session-private and automatically deleted at the end of the transaction or session.

86. **What is an external table?**  
    A table that allows querying data in external files (flat files) as if they were database tables.

87. **What is a database link?**  
    A connection from one database to another that allows querying remote objects.

88. **What is a synonym vs public synonym?**  
    Private synonym is visible only to the owner; Public synonym is visible to all users.

89. **What is GRANT and REVOKE?**  
    GRANT gives privileges to users/roles; REVOKE removes them.

90. **What is a role?**  
    A named group of privileges that can be granted to users for easier privilege management.

91. **What is the difference between SYS and SYSTEM?**  
    SYS owns the data dictionary and has all privileges; SYSTEM is used for administrative tasks and has fewer privileges by default.

92. **What is a listener?**  
    A process that listens for incoming client connection requests and hands them off to a database server process.

93. **What is TNS?**  
    Transparent Network Substrate — Oracle’s networking layer that handles client-server communication.

94. **What is the difference between shared server and dedicated server?**  
    Dedicated: one server process per user session. Shared: multiple sessions share a pool of server processes.

95. **What is AWR?**  
    Automatic Workload Repository — collects, processes, and maintains performance statistics for problem diagnosis.

96. **What is ADDM?**  
    Automatic Database Diagnostic Monitor — analyzes AWR data and provides recommendations.

97. **What is a histogram?**  
    Statistics that describe the distribution of data in a column, helping the optimizer make better cardinality estimates.

98. **What is cardinality?**  
    The number of rows estimated to be returned by a particular operation in the execution plan.

99. **What is bind variable?**  
    A placeholder in a SQL statement (e.g., :id) that is replaced with a value at runtime, improving performance and security.

100. **What is SQL injection and how to prevent it in Oracle?**  
    An attack that injects malicious SQL. Prevent by using bind variables, stored procedures, and least-privilege principles. Never concatenate user input into SQL.
