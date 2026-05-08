Variables and constants
Variables and constants associate a name with a FeatureScript value. Variables are declared with the var keyword, and constants are declared with the const keyword:

var x = 1;
const y = 2;
The value of a variable may be changed at any point later on.

x = 3; // succeeds
The value of a constant, once it is set, can never be changed.

y = 3; // error: cannot assign to constant y
Value semantics
FeatureScript values always behave as if copied on assignment, and references to values are not shared (unless a box is used):

var a = 10;
var b = a;
a = 20;

println(a);     // prints "20"
println(b);     // prints "10"
Inside a function, the passed in arguments and the return values also behave as if a deep copy were made.

Statement blocks
A statement block is delimited with braces ({}). Blocks can be added around any set of statements, and are used as part of many control flow structures.

A statement block defines a variable scope. Variables and constants are only visible inside the scope where they are defined:

var visible = "hello";
if (condition)
{
    var invisible = "hello";
}
println(visible);       // prints "hello"
println(invisible);     // semantic error: variable invisible not found
Unset variables
If a variable is declared, but no value is assigned, its value is set to undefined.

var u;
println(u);             // prints "undefined"
Type constraints
By default, a variable's type is unconstrained, and may change on assignment. A variable or constant may be declared to always be a certain type by adding the 'is' keyword and a type name following the variable name:

var x = 1;
var y is number = 1;

x = "string";           // succeeds
y = "string";           // runtime error: type mismatch
Variables with type constraints must be initialized immediately to a value matching that type.

var nil is number = 0;  // succeeds
const n is number = 10; // succeeds

var nil3 is number;                 // parse error: variable with type must be initialized
var nil2 is number = undefined;     // runtime error: value assigned to variable should be number, was undefined
Standard types
All values in FeatureScript have exactly one standard type. The standard types in FeatureScript are boolean, number, string, array, map, box, function, builtin, and undefined.

Boolean
A boolean may be one of two values, defined with the literals true and false.

var shouldCut = true;
Number
A number is a 64-bit floating point number, conforming to the IEEE double-precision standard. A integer is simply a special case of number, and does not have a its own standard type.

number literals can be declared in any of the following ways:

var one = 1;
var alsoOne = 1.0;
var bitLess = -.01;
var million = 1e6;
var infinity = inf;
The value of NaN (not a number) does not exist in FeatureScript. Operations which return NaN in other languages, such as the square root of a negative number, will instead throw an error immediately.

String
A string is a series of characters representing text.

string literals can be in either single quotes or double quotes (which are treated identically), and may contain common escape sequences.

var message1 = "Hello, world!";
var message2 = 'FeatureScript,\nnot FutureScript';
var message3 = "Smile \u263A";
The simplest way of working with strings is with regular expressions, using a few functions defined in the string module:

var str = replace("The answer to everything is 42.", "[1-9]+", "smarter features");
Array
An array is an ordered list of values, which need not be of the same type.

An array literal can be declared with brackets:

var empty = [];
var numbers = [1, 2, 3];
var things = ["1", 2, ["inner", "array"]];
Array elements are accessed and changed by indexing into the array with a zero-based index:

var x = numbers[0];         // x is 1
x = things[2][1];           // x is "array"

var index = 1;
x = numbers[index];         // x is 2

x = empty[0];               // Throws out-of-range error

things[2] = 42;             // things is now ["1", 2, 42]
The safe navigation operator ?[...] can be used to access array elemets:

var x = undefined;          // x is undefined
var z = x?[1];              // z is undefined
Simple array manipulations can be done with functions defined in the containers module:

var s = size(numbers);              // s is 3
var arr = makeArray(3);             // arr is [undefined, undefined, undefined]
var arrFalse = makeArray(3, false); // arrFalse is [false, false, false]

numbers = append(numbers, 4);                   // numbers is [1, 2, 3, 4]
numbers = concatenateArrays([numbers, [5, 6]]); // numbers is [1, 2, 3, 4, 5, 6]
numbers = resize(numbers, 3);                   // numbers is [1, 2, 3]
Iteration over an array can be done with a simple for loop:

for (item in collection)
{
    println(item);
}
Map
A map is an collection of key-value pairs which allow the value to be quickly accessed by its key.

A map literal is declared inside braces, with commas separating key-value pairs, and colons separating keys from values.

var map1 = {};
var map2 = { "a" : 1 };
Any value may be used as a map key, and a deep copy of the value is used. String keys may be written with or without quotes. However, if a visible variable exists with the same name as a map key, this must be disambiguated, either by adding quotes (to indicate the string), or by adding parentheses (to indicate the variable).

var b = 2;
var map3 = {
    one : 1,
    (b) : "two",
    3.5 : "three point five"
};
// map3 is { "one" : 1, 2 : "two", 3.5 : "three point five" }
Map elements are accessed or changed using the map key. If the map key is a string that is a valid identifier, dot syntax may be used.

Map elements can be accessed using the safe navigation operator ?.. This eliminates the need for explicit checks and conditional handling.

var val = map2.a;       // v is 1
val = map2["a"];        // v is 1

map2.a = 0;             // map2 is now { "a" : 0 }
map2.b = 1;             // map2 is now { "a" : 0, "b" : 1 }

var map4 = undefined;
var d = map4?.a;        // d is undefined
If a key does not exist on the map, the result is undefined. A map value can never be undefined, and setting the value to undefined removes the element from the map.

val = map2.c;           // val is undefined
map2.b = undefined      // map2 is now { "a" : 0 }
Simple map manipulations can be done with functions defined in the containers module:

s = size(map2)                  // s is 1
x = isValueIn("two", map3);     // x is true
Maps can also be iterated over with a for loop:

for (var key, value in myMap)
{
    println("Key: " ~ key ~ ", Value: " ~ value);
}
In FeatureScript, maps are ordered deterministically. However, this ordering can be unintuitive, especially if the keys are of different types. See Equality and ordering for details.

Box
As mentioned above, value semantics are ubiquitous in FeatureScript. Function parameters are passed by value, function returns are returned by value, and variable assignment is always by value.

Reference semantics are useful when, for example, a function needs to modify one of its inputs, or two variables need to point to the same underlying data. This can be accomplished with boxes.

A box literal can be declared with new box(value):

var b1 = new box(1);    // b1 is a box containing the number 1
var b2 = b1;            // b2 is a box equal to b1, containing the same number 1
var b3 = new box(b1);   // b3 is a box containing the box b1
The value inside a box is accessed and changed by adding empty brackets after the box. The safe navigation operator can be used to avoid runtime errors by handling cases where value of box is undefined:

var b = b1[];           // b is 1

b1[] = "new value";     // b1 now contains "new value"
println(b1[]);          // prints "new value"
println(b2[]);          // prints "new value"
println(b3[][]);        // prints "new value"

var b4 = undefined;     // b4 is undefined
var b5 = b4?[];         // b5 is undefined
Function
Generally, functions are declared at the top level of a module. However, it is often useful to use a function as a variable, called a lambda function.

A function literal can be assigned to a variable as follows:

var f = function(x) { return x + 1; };
var f = x => x + 1;
The => syntax supports a single parameter without parentheses or a full parameter list, and either an expression or a function body. For example:

const twice = (v is ValueWithUnits) returns ValueWithUnits => v * 2;
const thrice = (v is ValueWithUnits) => { return v * 3; };
var fourfold = v => v * 4;
var apply = (f is function, val) => f(val);
var doubled = (val is ValueWithUnits) => apply(twice, val);
var cascaded = (a => b => c => a * b + c)(4)(5)(6);  // value is 26
This function can be called with arguments, just like any other function.

var sum = f(1);         // sum is 2
One example of a lambda function is in the Standard Library's sort function:

var edgeQuery is Query = qEverything(EntityType.EDGE);
var edges is array = evaluateQuery(context, edgeQuery);

var sortedEdges = sort(edges, function(edge1, edge2) {
    return evLength(context, edge1) -
           evLength(context, edge2);
});
// sortedEdges is an array of edge queries, from shortest to longest
Another omnipresent example is in a feature type declaration:

annotation { "Feature Type Name" : "My Feature" }
export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        // Define the parameters of the feature type
    }
    {
        // Define the function's action
    });
defineFeature takes a lambda function as a parameter, and returns another lambda which calls the function passed in, along with some setup and cleanup.

Builtin
A builtin is a black box, whose contents cannot be accessed or changed directly in FeatureScript. A builtin is designed to be created by and passed into functions in the Onshape Standard Library. Examples of builtins are a Context, which stores the geometry of a Part Studio, and a Sketch, which stores the geometry of a sketch.

Undefined
undefined is a special type which can take only one value, also named undefined.

undefined is intended to be the FeatureScript representation of a value which does not exist. It is the result of a failed try() expression, an unset variable, or a nonexistent map entry.

Type tags
Custom types and enums exist throughout the standard library, and may be defined as top-level constructs. In addition to its standard type, a FeatureScript variable may have a type tag assigned, which represents a more specific contract that the variable should uphold.

A type tag may be checked with the is operator, which returns a boolean:

if (x is Vector)
{
    // do something
}
Enums
An enum is an enumeration of a finite set of choices.

export enum LumberSize
{
    TWO_BY_FOUR,
    TWO_BY_SIX,
    TWO_BY_EIGHT
}
An enum value is a string which is one of the enum's choices, tagged with the enum's type. For example, LumberSize.TWO_BY_FOUR is the string "TWO_BY_FOUR" of with the type tag LumberSize.

var size is LumberSize = LumberSize.TWO_BY_FOUR;
Custom types
A custom type defines the conditions for a member inside a typecheck, which must be defined as a top-level predicate.

export type Lumber typecheck isLumber;

export predicate isLumber(value)
{
    value is map;
    value.size is LumberSize;
    isLength(value.length);
}
A custom type generally exports a constructor from the same module which exports the type. The standard naming convention is for custom types to begin with an upper-case letter, and for the constructor name to match the type name with a lower-case first letter.

export function lumber(size is LumberSize, length is ValueWithUnits)
{
    return { "size" : size, "length" : length } as Lumber;
}
The as keyword, as used above, will attach the given type tag to any value. It should be used with caution, since it's possible to attach a type tag to a value which does not satisfy the type's typecheck.