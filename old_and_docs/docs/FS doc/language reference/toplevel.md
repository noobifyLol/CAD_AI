FeatureScript has several types of top-level constructs you can put directly into a module. These are imports, subroutines (functions, predicates, operator overloads), constant declarations, and type (enum and custom type) declarations. A top-level construct may be exported by prefixing it with the export keyword, to make the symbol it defines visible to modules importing this module.

Imports
An import construct imports an Onshape tab (which may be a Feature Studio, a Part Studio, or an uploaded file) as a FeatureScript module. It has the form import(path : "some path", version : "some version");. Currently an import may be of one of three forms (the third of which may disappear):

A tab in the current document. In this case, the path needs to be the tab id (the 24-character string after the /e/ in the URL when looking at the tab. The version is populated automatically on commit to be the latest microversion of the tab.
A tab in a version of another document. In this case, the path needs to be of the form documentId/versionId/tabId. These ids are 24-character strings found after /documents/, /v/, and /e/ in the URL, respectively. The version needs to be the microversion of the tab in that version (which is not trivial to determine; we're working on it).
A tab from the standard library. In this case, the path needs to be of the form onshape/std/tabName.fs and the version is the version name, like 255.0.
Like other top-level constructs, an import may be exported, which makes the imported symbols visible to other imports. An import may also be used with a namespace, in which case all symbols it brings in can only be accessed through that namespace.

    myNamespace::import(path : 'onshape/std/math.fs', version : '255.0');
    const PI2 = myNamespace::PI * 2;
Subroutines
FeatureScript has several types of subroutines: functions, predicates, operator overloads, and lambda functions (which are not top-level constructs). Every kind of subroutine takes zero or more arguments and returns a value. The arguments may have type constraints specified using the is keyword for overload resolution and type safety.

Functions
A function is a subroutine similar to what other languages have: it takes arguments, executes statements in its body and returns a value.

    function fourthPower(x)
    {
        const square = x * x;
        return square * square;
    }
If a function executes a return without a value or reaches the closing brace without returning, it returns undefined. A function may have a return type constraint (e.g., function fourthPower(x) returns number { ... }) which triggers an error if a value that does not satisfy the type constraint is returned.

Predicates
A predicate is a special type of subroutine that always returns a boolean. No assignments or statements with a side effect are allowed inside a predicate. No variable declarations are allowed, except for the loop variable as in for (var ... in ...) ....

A predicate either succeeds or fails. A predicate succeeds if and only if every expression statement executed evaluates to true. An expression statement is an expression followed by a semicolon. It does not include conditions for loops or if statements.

predicate canBeUsed(x, y)
{
    isUseful(x); // Expression statement
    if (y is array) // Not an expression statement, but controls whether the following code block is evaluated
    {
        for (element in y) // Creates loop variable "element"
        {
            element is UsefulType; // Expression statement evaluated on every element in y
        }
    }
}
Statements that are not executed do not matter. In the above example, the for loop may never be executed.

A predicate fails and returns false immediately if any expression statement evaluates to false. A predicate raises an exception if any expression statement does not evaluate to true or false.

Predicates are often used in preconditions. A typecheck for a custom type must be a predicate.

Operator Overloads
FeatureScript supports overloading the following operators: + - * / % ^ <. An overload is declared as follows.

    operator*(x is Vector, y is number)
    {
        ...
    }
An operator overload must have two arguments, with the exception of -, which may have one (to overload negation). At least one argument must have a custom type or enumeration constraint.

When operator + is overloaded, that overload is also applied to += and similarly for - * / % ^. The operator < must be declared to return a boolean. When operator < is overloaded, that overload is also called when > <= >= is used.

Preconditions
Any subroutine may have a precondition. A precondition has assertions about arguments. For example, if an argument must be a positive integer for the function to behave sensibly, then this should be checked in a precondition.

A precondition is written between the function arguments (and return type, if any) and body. A precondition is the keyword precondition plus one statement. Usually the statement will be a block statement with several statements inside.

function sqrt(n is number) returns number
precondition n >= 0;
{ ... }


function makeArray(n is number) returns array
precondition
{
    isInteger(n);
    n > 0;
}
{
    ...
}
The precondition is evaluated like a predicate. If one of the expression statements of the precondition fails, an exception is raised and the subroutine call is aborted. Preconditions are also used to define feature dialogs.

Lambda functions
Functions may be declared inside other functions or initializers of top-level constants. In FeatureScript (and many other languages) these functions are called lambdas. Lambda functions can be specified either with the function keyword, or can use the shorter => form, similar to JavaScript.

Unlike top-level functions, lambdas are values. They can be assigned to variables and used in expressions. Lambdas do not have names of their own, but may be assigned to variables, passed to other functions, or used inside of other expressions.

const zero = function() { return 0; };
const doubled = (val) => val * 2;
All functions have the same standard type, function. The expression value is function returns true if a value is a lambda. There is no way to test argument type, argument count, or return type. Calling a lambda with the wrong type or number of arguments results in a runtime error.

Overload resolution
Multiple top-level subroutines may be declared with the same name but different argument numbers and type constraints. These subroutines are said to overload against each other. A predicate cannot have the same name as a function.

When a function or a predicate is called or an overloadable operator is used, FeatureScript performs overload resolution based on argument types to determine which subroutine to call. Overload resolution finds the most-specific satisfying overload.

A subroutine declaration is a satisfying overload if it has the same number of arguments as the call and the arguments satisfy the type constraints. For instance, function foo(x is map) is a satisfying overload for foo({}) or foo(meter) (because meter is a map with a type tag) but not foo({}, 1) or foo('abc').

Overload 1 is more specific than Overload 2 if every argument in Overload 1 is at least as specific as the corresponding argument in Overload 2 and at least one argument is more specific. A type tag constraint is more specific than a standard type constraint and that is more specific than an unconstrained argument. For example, function foo(x is ValueWithUnits, y is number) is more specific than function foo(x is map, y), but is not more specific than foo(x is map, y is NumberWithTag).

If a satisfying overload is not found or there is no single most-specific satisfying overload, an exception is raised.

Constant declarations
A constant may be declared as a top-level construct in a module. The syntax is the same as for the const statement (see Statement types). The initializer may call functions and reference other constants, but cycles are not allowed: there must be an order in which constants can be initialized. A top-level constant may also not contain a box or a builtin.

Enumeration declarations
An enumeration is declared as follows.

enum Weekend { SATURDAY, SUNDAY }
Enums should generally be referred to using the dot syntax: Weekend.SATURDAY. The representation of Weekend.SATURDAY is the string 'SATURDAY' with the type tag Weekend. The expression Weekend itself evaluates to a map with keys 'SATURDAY' and 'SUNDAY' and the values being the enum values. Note that this map is not traversed in the order that the enum is declared.

Custom type declarations
The following declares and exports the type Person.

export type Person typecheck canBePerson;
export predicate canBePerson(value)
{
    value is map;
    value.firstName is string;
    value.age is number;
    value.age > 0;
}
The typecheck predicate currently only serves as documentation for the type. In the future, at least in some cases, it will be executed on values with the type tag and report warnings on failure.