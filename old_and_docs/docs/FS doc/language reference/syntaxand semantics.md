Syntax and Semantics
FeatureScript syntax is similar to JavaScript and other C-like languages (C, C++, C#, Java).

Two general considerations about program evaluation should be mentioned here.

Some values are described as "must be" a certain type. The system may warn if an operand is obviously wrong, like 0 where a boolean is expected, even if the code might not be executed. Otherwise an exception is raised when the incorrect type is found during execution.

In general, components of an expression execute from left to right, with each one complete before the next is started. For example, in x[f1()](f2(), f3()), the function expression x[f1()] comes first, then f2(), then f3(). Most FeatureScript expressions are not sensitive to evaluation order.

Statement types
A variable declaration begins with with var and the variable to be declared. It may have a type restriction and an initializer.

var x;
var y = 0;
var z is Vector = vector(0, 0);
If a variable has a type it must also have an initializer.

A constant declaration is like a variable declaration except the const keyword is used and an initial value is required. A constant cannot be modified after initialization.

const one = 1;
const e is number = exp(1);
An assignment statement modifies a variable or part of a variable. The value to be modified appears at the left. It is optionally followed by accessors, dots and square braces, to modify only part of the value.

a = 1;          // scalar
b.c = false;    // map
b['c'] = false; // same as previous
d[] = 0;        // box
e[0] = 0;       // map or array
f.g.h[] = 0;    // box in map in map
An expression statement is an expression followed by a semicolon. Normally the expression will be a call to a function that does something; otherwise the expression probably won't have any effect.

x;   // valid reference to variable x, but does nothing
f(); // calls a function that might do something
A block statement is a sequence of statements in curly braces. Statements are executed in sequence.

{
    var x = 0;
    f(x);
}
A return statement exits the current function, or the innermost function if inside more than one. A return value may be provided. If none is provided the function returns undefined. Either way, the type of the return value must be the same as any declared function return type.

return; // = return undefined
return 0;
An if statement works in the usual way. The condition must be a boolean. The statement (usually a block statement) after if executes if the condition is true. If the condition is false and there is an else statement, the else statement executes.

FeatureScript has three types of loop statements, while and two forms of for.

A while loop executes a statement as long as a condition is true. The condition must be a boolean.

while (!done)
{
    x += 1;
    done = f(x);
}
A for loop works in the usual way: for (init; cond; incr) executes init (which may declare a variable), executes the loop body as long as cond (which must be a boolean) is true, and executes incr after each loop iteration unless the loop is exited with break. Incr (the "increment") must be a function call or an assignment.

for (var i = 0; i != 10; i += 1)
    f(i);
A for-in loop applies the loop body to each element of a container. It can be used with either one (for (var a in x) stmt;) or two (for (var a, b in x) stmt;) variables. It starts by evaluating x (which must be an array or a map), then the body statement is executed once for each item in x. If two variables are used, then a will be bound to the key (for a map) or index (for an array) and b will be bound to the value. If one variable is used, it will be bound to each item (for an array), or a new map in the format of { key: ..., value: ... } (if x is a map). The var keyword may be omitted; then a previously-declared variable from the surrounding scope is used. For maps, the loop follows the standard order of keys; see Equality and ordering.

// one-variable iteration over an array
for (var x in [1, 2, 3])
    println(x); // Prints: 1, 2, 3

// one-variable iteration over a map
for (var x in { "a": 1, "b": 2, "c": 3 })
{
    var key = x.key;
    var value = x.value;
    println(key ~ "=" ~ value); // Prints: a=1, b=2, c=3
}

// two-variables, map
for (var key, value in { a: 1, b: 2, c: 3 })
    println(key ~ "=" ~ value)  // Prints: a=1, b=2, c=3

// two-variables, array
for (var index, value in [100, 200, 300])
    println(index ~ "=" ~ value)  // Prints: 0=100, 1=200, 2=300
A break statement (break;) stops execution of the innermost loop, continuing with the statement after the loop.

A continue statement (continue;) exits out of the current iteration of the loop without exiting the loop. In a for loop the loop increment is executed.

Try, catch, and throw statements are used in exception handling. See Exceptions.

Expression types
Literal expression. A literal can be a constant expression like 1 or "Hello, world", or can construct a container object, like [1, "Hello, world"]. See Types and type tags.

Variable references are simply the name of the variable; there is no special syntax like $ before the name.

Function call expressions are a top level function or expression followed by a comma-separated argument list in parentheses. If the expression evaluates to a value, it must be a function, it must expect the same number of arguments, and all the is constraints in the argument list must be satisfied in the same way as for an is expression. If the expression does not evaluate to a function, it must be an identifier naming a top level function or functions. See Overload resolution.

Function call expressions support an "arrow" syntax that extracts the first argument. E.g., x->f(y, z) is equivalent to f(x, y, z). Any expression may be given for the arguments (in this case x, y, and z), but the function name (in this case f) must be an identifier. All arguments must be provided. This syntax is useful for flattening nested function calls: for example, while myArray->max()->clamp(0, 1)->roundToPrecision(5) is equivalent to roundToPrecision(clamp(max(myArray), 0, 1), 5), the former is easier to write and read.

A lambda expression (also called an anonymous function) is introduced with the function keyword followed by an argument list and function body. A shorter alternative form (similar to lambda expressions in JavaScript) is also supported: a single parameter or a parameter list, followed by a =>, and then followed by an expression or function body. For example x => x^2 or (a is number, b is number) => a * b or (a, b) => { const c = a^2; return b * c; }. See Lambda functions.

An expression surrounded by parentheses and preceded by try yields undefined if an exception is raised during execution. See Exceptions.

Components of a container can be accessed with []. If the left hand side is a box, no value appears inside. Otherwise an array index for an array or a map key for a map is inside. An array index must be a number, a non-negative integer. A map may also be accessed with the dot (.) operator; the right hand side is string without quotation marks. This form is only valid if the key is a valid token, starting with a letter or underscore, containing letters, numbers, and underscore, and not a keyword used in the language.

x[];  // box access
x[1]; // array or map access
x.y;  // map access, x['y']
x.y.z; // map access, (x.y).z
Unary operators are - for numeric negation and ! for boolean negation (not).

Binary operators are + - * / % ^ ~ < > <= >= == != && ||. They have the usual meanings except ^ is used for exponentiation and ~ for string concatenation. The sign of the result of % is the sign of the second operand.

Type expressions are an expression, the keyword as or is, and a type name. The as operator adds or removes a type tag. The is operator tests whether an expression is a type. See Types and values.

4 as number;
vector(0,0) as array;
x is Vector;
FeatureScript has "short-circuiting" logical operators && and ||. They do not evaluate their second operand unless they need to. If the first operand of && is false, the result is false. If the first operand of || is true, the result is true. Otherwise, the second operand must be a boolean and provides the result of the expression.

FeatureScript has the same conditional cond ? expr1 : expr2 operator found in other C-like languages. The condition expression must be a boolean. If it is true, the result is the expression after ?. If it is false, the result is the expression after :.