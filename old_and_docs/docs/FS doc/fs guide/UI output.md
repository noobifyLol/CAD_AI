Naturally, the most useful output of a feature is the geometry changed and/or created by the feature. However, there are a number of other ways a feature can output useful information, some of which are primarily useful for debugging your own features, and some of which can provide information to the end user of a feature type.

Print
print and println are two functions defined in the Onshape Standard Library. You may pass any variable into these functions, including string literals.

print("x is ");     // Prints the string "x is "
println(x);         // Prints a string representation of the value x, followed by a newline
Like any other FeatureScript statements, the above code will run inside a Part Studio when the feature containing them is added. Their output will be visible in the FeatureScript notices flyout:

Printed text

println uses the toString() method defined for a type. To see a (generally more verbose) literal output, you can convert the value to its raw string representation by concatenating it the value with an empty string:

println(1 * meter);         // Prints "1 meter"
println("" ~ (1 * meter));  // Prints "ValueWithUnits : { "unit" : UnitSpec : { "meter" : 1 } , "value" : 1 }"
Debug
When writing a feature type, it is often useful to see the where the entities and geometry related to a given feature are positioned in the Part Studio.

The graphical output of debug is only visible while the feature dialog is open.

By calling the debug function on any Query, you can see the entities matching the query in the Part Studio:

debug(context, qAdjacent(definition.edge1, AdjacencyType.EDGE, EntityType.FACE));
debug(context, qAdjacent(definition.edge2, AdjacencyType.VERTEX, EntityType.FACE));
Debug example

Calling the debug function on geometric types, like Line and Vector, shows a representation of the geometry they represent:

var myLine is Line = evEdgeTangentLine(context, {
    "edge" : definition.edge1,
    "parameter" : 0.5
});
var myPoint is Vector = myLine.origin + myLine.direction * 2.5 * inch;

debug(context, myLine);
debug(context, myPoint);
Debug geometry example

For more examples of data which may be debugged, see the debug module.

Timers
FeatureScript provides the startTimer and printTimer methods for rough performance profiling. A typical usage is:

startTimer();
possiblyExpensiveFunction();
printTimer();
The output will be the number of elapsed wall-clock milliseconds printed to the notices flyout, as with print.

Multiple timers may be used simultaneously by identifying them with strings:

startTimer("overall");
expensiveCall1();
for (var x in someRange)
{
    startTimer("individual call"); // resets the timer
    expensiveCall2();
    printTimer("individual call");
}
printTimer("overall");
The reported timings may vary for a variety of reasons. If the startTimer/printTimer calls are in different features, the timing may be meaningless because the features may be regenerated at different times.

Error Handling
When developing robust custom features, error handling has two sides: being prepared for errors that operations and evaluation functions throw and reporting meaningful errors to the user of the feature. Feature errors may be reported at three different severity levels:

Info, using reportFeatureInfo creates a blue bubble with the message while the feature is being edited.
Warning, using reportFeatureWarning creates a blue bubble and turns the feature red in the feature list.
Error, using throw regenError(...) undoes all context changes the feature has made (making the feature a no-op) and turns the feature red.
The default error flow is for any thrown error to be propagated all the way to the top level feature in the Part Studio. For example, if the custom feature includes an opFillet and the geometry cannot be filleted, opFillet will throw a regeneration error with ErrorStringEnum.FILLET_FAILED as the status. If the custom feature does not catch the error, it will fail and the user will see: "Failed to fillet selections." If the custom feature is something like a fillet pocket, that is a reasonable error message. If it is something like a rib-with-fillet, an adjustment of the error message is helpful:

...
try
{
    opFillet(context, id + "fillet", { "entities" : ribPartEdges, "radius" : definition.filletRadius });
}
catch
{
    throw regenError("Failed to fillet the interface between the rib and the selected part.", ribPartEdges);
}
...
Adding the ribPartEdges argument to regenError will cause the edges that failed to fillet to highlight in red, giving the user a hint of where the problem is. In other cases, it makes sense for the feature not to fail even if one of the operations or evaluation functions fails. For example, a feature that makes multiple notches of some kind may be structured as:

...
var failedCount is number = 0;
for (var notch in notches)
{
    try
    {
        makeNotch(context, notch);
    }
    catch
    {
        setErrorEntities(context, id, { "entities" : notch.locationQuery });
        failedCount += 1;
    }
}
if (failedCount == size(notches))
    throw regenError("Failed to create notches");
if (failedCount > 0)
    reportFeatureWarning(context, id, "Failed to create " ~ failedCount ~ " notches.");
...
In this case, the feature fails when all notches fail and reports a warning when some of the notches fail. For details about FeatureScript exceptions, see Exception handling.