Types and type tags
Types in FeatureScript are dynamic (i.e. type errors are detected during execution). Every value belongs to exactly one standard type and possibly has one type tag marking it as an enumeration or a custom type.

Types are not hierarchical, parameterized, or dependent. There is no such type as "number box" that can hold only a number or "array of length 3" with exactly three values. Custom types can be used to simulate some parameterized types.

Types are tested with the is operator and changed with the as operator.

Every FeatureScript value belongs to exactly one of these standard types:

undefined, with one value undefined
boolean, with two values true and false
number, in IEEE 64 bit format including -0, -inf, and +inf, but not NaN.
string, a Unicode string
array, a fixed size heterogeneous collection indexed by small integers
map, a heterogeneous collection indexed by values
box, a mutable container holding a single value at a time
builtin, an opaque type understood only by the runtime system
function, a lambda (closure) created using a function expression.
Arrays, maps, and boxes are mutable, meaning they contain internal state that can be changed. (As distinct from assigning to a variable.) Assignment, argument passing, and value return make deep copies of arrays and maps, so such mutation affects only the variable assigned to.

var a = { 0 : false, 1 : true }; // A map with two entries
var b = a;
a == b; // Structural equality, not physical equality
a[0] = true;
a != b; // The map in b did not change.
Boxes can be used like C pointers or Java references to allow a change to escape its scope. This function returns a function with an internal counter.

function counter() returns function
{
    const b = new box(0);
    return function() { b[] += 1; return b[]; };
}
Type conversion
Type tags are added to values with the as operator. The expression v as TypeId yields a value that is identical to v except that it has a type tag TypeId.

If the type is an enumeration, the value must be a string that is a member of the enumeration.

If the type is a standard type, the value must belong to that type. For example, '0' as number does not convert the string '0' to a number.

Because a value has at most one type tag, any previous type tag is discarded by the as operator. If the type operand is a standard type, the result of the as operator no longer has a type tag.

enum E { A }
E.A is E == true
E.A is string == true
(E.A as string) is string == true
(E.A as string) is E == false
Values with different type tags are not equal. Assuming x is a map that satisfies the predicate for type ValueWithUnits but is not of that type

x != (x as ValueWithUnits)
but

x == ((x as ValueWithUnits) as map)
Assignment to part of a container (mutation) does not affect the type tag. The value may no longer satisfy the predicate associated with its custom type. (This behavior may change and programs should not rely on it.)

Predefined operators on standard types produce a new value without a type tag. If + is not overloaded,

(2 as Even) + (2 as Even) == 4
(2 as Even) + (2 as Even) != (4 as Even)
Type testing
Types are checked by the is operator. A value always "is" exactly one standard type, and "is" also the type of its type tag if it has one.

Continuing a previous example

x is map == true
(x is ValueWithUnits) == false
(x as ValueWithUnits) is map == true
(x as ValueWithUnits) is ValueWithUnits == true
Standard types
Undefined
There is one instance of the type undefined, also called undefined. Examples of undefined values include

An uninitialized variable
The return value of a function that "falls off the end"
The result of looking up a key that is not present in a map
Booleans
Booleans (type name boolean) are either true or false. There are no implicit conversions to boolean, so write if (x != 0) rather than if (x). (This is consistent with Java but not with C, JavaScript, and Python.)

Numbers
Numbers (type name number) use IEEE double precision floating point format. Positive and negative infinity are numbers. NaN is not a number and expressions that evaluate to NaN raise runtime exceptions. Every value is equal to itself. Positive and negative zero are equal to each other, consistent with the IEEE floating point standard.

An integer is a number that is exactly equal to an integer. The range of integers is +/- 2^53. Addition, subtraction, and multiplication of integers yield integers if arguments and result are both in this range. Other calculations may unexpectedly yield non-integral results due to rounding error. Expressions written in FeatureScript respect the evaluation order implied by the parse tree. FeatureScript executes in round-to-nearest mode (C/C++ FE_TONEAREST). If problems persist, consult a numerical analyst.

Library functions may allow approximate integers. These will specify a tolerance.

Strings
Strings (type name string) hold Unicode characters. String constants are described in lexical conventions. Characters can be extracted with the standard library splitIntoCharacters function. Bytes can not be extracted and the internal encoding is not program-visible.

Regular expression matching and replacement are also available using the match and replace functions. The ~ operator concatenates strings. If its operands are not strings, they are first converted into strings using an internal algorithm. The toString function has been implemented for a number of library types to convert values into a more convenient string form. For example 2 * meter ~ "" evaluates to a string like: "ValueWithUnits(27) : { "unit" : UnitSpec(28) : { "meter" : 1 } , "value" : 2 }" while toString(2 * meter) returns "2 meter".

Containers
FeatureScript provides three types of containers: unordered maps, ordered arrays, and modifiable boxes. The container access operator [] may be used to look inside any container. The map access operator . may be used to look inside a map. Box references may always be assigned to. Other container accesses may be assigned only if the base object is a variable. Safe navigation operators ?. and ?[...] can be used to access elements inside boxes, arrays and maps. If any of these containers are undefined, the expression evaluates to undefined instead of causing an error. This can eliminate the need for explicit checks and conditional handling.

Application of an access operator to the wrong type is an error, generating an execution exception at runtime.

In the current implementation, static analysis does not warn about expressions like true.x that will always fail at runtime.

Arrays
Arrays (type name array) are modifiable, heterogeneous collections indexed by small, non-negative integers. The first index is 0.

Arrays are created by array literals,

var a = [1,2,3,4];
a[0] == 1;
var b = undefined;
var c = b?[0] // c will be undefined
var d = a?[1] // d == 2
It is an error to read or write a negative index, a non-integral index, or an index past the end of the array. Arrays do not grow on write. The standard library module containers.fs defines functions to create or modify arrays.

Maps
A map (type name map) is a heterogeneous collection indexed by values. Duplicate keys are not allowed. An older value with the same key is replaced when a new key is added.

Applied to a map, the [] operator accepts any value as argument:

m["field"]
m[693.5]
m[undefined]
Map keys are usually strings. When the key is string that is a non-reserved identifier it may be written unquoted as the right operand to the dot operator:

m.field
The result of map indexing is an lvalue in C terminology: it may be assigned to or evaluated for its value.

m.three = 3;
Assignment creates a new map key if required, or replaces an existing key.

A reference to an absent key returns undefined. This is not an error. User code is responsible for handling missing keys.

Because attempting to reference a field of undefined or other non-map type is an error code should not execute x.y.z unless x.y is known to be a map.

Storing a value of undefined to a map removes the key. Iteration over a map will not visit entries with undefined values.

LHS op= RHS behaves as in C: LHS = LHS op RHS, with side effects in evaluation of LHS only happening once. It is not an error to apply op= to an initially absent field, but the operator will receive undefined as its first operand. For example,

var x = {}; // empty map
x.k += 1;
is the same as

var x = {}; // empty map
x.k = x.k + 1;
which is an error because the + operator does not know how to add undefined to a number.

Maps are created by map literals. A map literal is a comma separated list of key:value pairs enclosed in {curly braces}. Both keys and values can be any expressions. If the key is a string that is also an non-reserved identifier it may be written unquoted. String keys may also be written as quoted strings. Empty maps are allowed. Key:value pairs are inserted left to right, so the last instance of a duplicate key has priority.

FeatureScript will complain if an unquoted key is the same as a variable name. Change {x:0} to {(x):0} to use the value of variable x as a key, or {'x':0} to use the string 'x' as a key.

Examples:

{} // empty map
{count:75, category:"chipmunks"}
var a = "hello, world";
{a:0, a:1} // {a:0, a:1}.["a"] == 1
{a:false, (a):true} // {a:false, (a):true}["hello, world"] == true
{{a:false}:true} // maps can be keys
{a:true,a:undefined} // same as empty map
var x = undefined;
var y = x?.k; // y will be undefined
var z = {count:75, category:"chipmunks"};
var k = z?.count; // k == 75
Boxes
A box (type name box) is a modifiable storage location that holds one value (including another box).

Because boxes introduce state, they are not allowed in certain contexts that must generate reproducible results. See "Purity".

A box is allocated with the new box construct which provides the initial value to be stored. The value inside a box is read or written with the the [] container access operator with no argument inside.

var b = new box(3);
var c = new box({x:0,y:1});
c[] = b[] + c[].y;
var d = undefined;
var x = d?[]; // x will be undefined
var y = b?[]; // y == 3
Builtins
Builtin types (type name builtin) hold runtime state that can not be expressed in FeatureScript. Modeling state is represented as a builtin. See standard library documentation.

Enumerations
The enum keyword declares an enumeration. All enumerations must be declared at top level, outside of any function. Syntax is as usual:

enum Example { A, B }
Note that trailing comma and semicolon are not allowed. An enumeration name is both a type and a value, an immutable map. Map values are strings with the tag of the enumeration type. So,

Example is map; // It's a value!
Example.A is Example; // It's a type!
Example.A is string;
An enumeration type tag may be added to a string with the as operator. If the string is equal to the name of one of the values, the operation succeeds (yields a value with a type tag). Otherwise, the conversion is an error and an exception is raised.

"A" as Example // same as Example.A
"Z" as Example // runtime error
0 as Example // runtime error
A value cannot be tagged as an enumeration unless its standard type is string.

Assignment and copying
The assignment operator = makes a copy of the value on the right side and stores it in the variable or field denoted by the left side. Parameter passing and function return work the same way as =. (The behavior of function return is probably not observable.)

Copies of values are deep copies. Fields of maps and arrays, and keys of maps, are copied as if by assignment, recursively if needed.

Boxes and builtins are exceptions to the preceding rule. Copying a box or builtin yields the same value. Thus boxes and builtins provide a way, and the only way, to share program-visible state between two unrelated functions, or for a child function to modify its parent's state.

There are nine compound assignment operators which work the same as in C: x op= y is x = x op y except side effects on the left side only happen once. The compound assignment operators are

+=
-=
*=
/=
^=
%=
||=
&&=
??=
~=
Because these operators work like ordinary assignment, the type tag of the result is determined by the binary operator rather than the type tag of the operands.

Redundant parentheses are not allowed on the left hand side, so x.y = (z) is valid but (x).y = z is not.

Note that the following

var recursive = {a:0};
recursive.a = recursive;
does not create a recursive data structure. The value of recursive.a is a copy of the value of recursive prior to assignment, i.e.

recursive == {a : {a : 0}}