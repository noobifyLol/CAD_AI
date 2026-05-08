Feature UI
The user interface to both custom and standard features is a feature dialog. This page describes methods to create the inputs to these feature dialogs, and two alternative ways of updating the parameters dynamically.

Defining a feature dialog
Onshape creates the feature dialog by doing a static analysis (rather than an execution) of the feature declaration, primarily of the precondition. If the feature declaration does not match the allowed form, warnings are reported and the feature is not made available to Part Studios. A minimal valid feature declaration is:

annotation { "Feature Type Name" : "Fancy Fillet" /* May have additional options */}
export const fancyFillet = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        // Parameter specifications go here
    }
    {
        // Feature Body
    });
This declaration can be easily extended in three places: The feature annotation, the feature precondition, and the feature body.

Feature annotations
A constant needs a "Feature Type Name" to be processed as a feature. Additionally, the following other fields can optionally be specified in the annotation map (with strings or arrays of strings):

"Manipulator Change Function": Name of the function to be called whenever a manipulator that this feature created is moved. See below.
"Editing Logic Function": Name of the function to be called whenever the user changes this feature definition. See below.
"Filter Selector": An array of strings used to find this feature in the feature list, when input as search terms after a colon. For example, if a feature specifies "Filter Selector" : ["foo", "bar"], then entering :foo or :bar in the feature list filter will show the feature.
"Feature Name Template": A template for naming new features, replacing the default of using the Feature Type Name. See variable.fs for an example.
"Tooltip Template": A template for feature tooltips, using the same syntax as the Feature Type Name. See variable.fs for an example.
"UIHint": Additional UI options, such as UIHint.NO_PREVIEW_PROVIDED, which prevents the preview slider from appearing.
”Feature Type Description”: A description of what the feature does and how to use it, to be displayed in feature tooltips and the “Search tools” panel.
"Icon": An icon to display for the feature.
"Description Image": A JPG, PNG, or SVG file to display as the description image for the feature.
Feature parameters
The parameter specification simultaneously serves as a validity check for the feature and a description of the UI for inputting that parameter. Any parameter specification may be annotated with a "Name", specifying the user-facing name of the parameter.

Parameter specifications may be factored out into predicates (e.g. usages of booleanStepScopePredicate in std). Parameters may also be made conditional by putting them in if statements.

Code snippets for the parameter specifications described in this section are available inside a Feature Studio in the parameter snippets menu:

Parameter snippets menu

Booleans
The specification of a boolean parameter in the precondition uses the is operator on the indicated definition field:

annotation { "Name" : "My Boolean", "Default" : true }
definition.myBoolean is boolean;
 Boolean in feature dialog
Boolean parameters are rendered as a checkbox by default, though this may be changed via UIHint. The "Default" field is optional and will be false if unspecified.

Strings
A string parameter is specified similarly:

annotation { "Name" : "My String", "Default" : "My default value" }
definition.myString is string;
 String in feature dialog
This creates a text box, whose input can be any FeatureScript string. The "Default" field is optional and will be empty if unspecified.

To set limits on the number of characters allowed, the "MaxLength" and "MinLength" annotation fields may be used.

Enums
An enum parameter is specified using the is expression and must refer to an enum that this module exports. Each individual enumeration value may have a user-visible "Name" annotation:

export enum MyOption
{
    annotation { "Name" : "Option One" }
    ONE,
    annotation { "Name" : "Option Two" }
    TWO
}
...
annotation { "Name" : "My Enum" }
definition.myEnum is MyOption;
 Enum in feature dialog
By default, an enum parameter is rendered as a dropdown menu with an option for every enum value, though this may be changed by providing a UIHint. For instance, UIHint.HORIZONTAL_ENUM will display the enum values as a group of tabs.

Any of the following fields can be specified in the annotation map of an enum parameter definition:

"Name": A user-visible name for the parameter.
"Default": The name of the value that should be the default. If unspecified, the first value will be used.
"Icon": An icon to be displayed alongside the parameter.
"UIHint": Additional UI options.
On the enum itself, each value may be annotated with one or more of the following:

"Name": A user-visible name for the value.
"Icon": An icon to be displayed alongside the value.
"Hidden": If true, the value will be hidden from end users. This can be used to hide a value that is no longer supported, for example.
Quantities
A quantity parameter represents a value with units. For instance, a one-dimensional length parameter may be specified with an isLength predicate:

annotation { "Name" : "My Length" }
isLength(definition.myLength, LENGTH_BOUNDS);
 Length in feature dialog
A quantity is rendered as a text box into which a number, a number with units, or a mathematical expression may be typed.

We currently support the following quantity and predicates to specify them:

Length: isLength
Angle: isAngle
Integer: isInteger
Real: isReal
Anything: isAnything
isAnything allows any expression with any units (see below) or even any FeatureScript type.

The other predicates require a bounds argument which specifies both the bounds and the default value. The value bounds module defines several common quantity bounds, but you can also define custom value bounds inline. For example, the following predicate specifies a default length of 1.75 inches:

annotation { "Name" : "My Length" }
isLength(definition.myLength, { (inch) : [ 0, 1.75, 10000 ] } as LengthBoundSpec);
A quantity parameter can be annotated with an icon.

Parameter expressions
Any time a feature requires user-specified parameters, it is also possible to enter an expression. For example, all of the following expressions can be typed directly into the entry field for a numeric parameter:

6
22/7 mm
sqrt(1 + sin(61deg)) / 8
(round(#myWidth, .1mm) + 2 inches) (assuming a variable named myWidth has been created)
See the FeatureScript math module for a list of all defined mathematical functions. For more details on numeric parameter expressions, including a list of accepted unit abbreviations, see the help documentation.

Parameter expressions are evaluated in two steps: First, they are pre-processed to convert units and variables to their true values. In particular, unit abbreviations such as 2 in are expanded to 2 * inch, and variables such as #foo are replaced by calls to getVariable("foo"). Then, the resulting expression is directly executed as FeatureScript. As a result, any valid FeatureScript expression can be entered into a parameter field (as long as the expression evaluates to the correct type).

Here are some advanced examples of FeatureScript functionality in parameter expressions:

Array indexing: [3, 1, 4, 1, 5][#index]
Ternary operators: (#myNum % 2 == 0) ? #myNum / 2 : 3 * #myNum + 1
Lambda functions: (function(x) { return (x^2 + 1) in; })(1)
Vector math: squaredNorm(cross(vector(1, 1, 2) * meter, vector(3, 5, 8) * meter))
An isAnything precondition accepts any parameter expression, regardless of its type. This can be used to enter values such as booleans and strings into custom features as expressions (which can refer to variables), or to enter other types such as vectors or lambda functions. The default value of an isAnything precondition will be placed into the parameter field, and therefore must be a string whose contents evaluate to a valid parameter expression, such as "57", "&quot;My string&quot;", "true", or "function(){ return &quot;Hello, world!&quot; }".

Queries
When the user selects entities (vertices, edges, faces, and bodies), they are passed to the feature as a query. The minimal query parameter specification is definition.myParameter is Query;. There are two query-specific annotations allowed that restrict what can be selected:

"MaxNumberOfPicks", which must be an integer literal
"Filter", which must be an expression as described below
Note that the feature should not rely on the queries satisfying the filter or evaluating to at most MaxNumberOfPicks because changes to upstream features may change the type of the selected entity or turn a single selected entity into multiple.

The "Filter" expression can contain values of the following enums:

BodyType
EntityType
GeometryType
ConstructionObject
AllowMeshGeometry
AllowFlattenedGeometry
ActiveSheetMetal
SheetMetalDefinitionEntityType
ModifiableEntityOnly
AllowEdgePoint
SketchObject
EdgeTopology
QueryFilterCompound
These values may be combined using &&, ||, and !, even though such an expression could not be evaluated outside of an annotation. For example, to allow only at most two sketch circles or arcs, use:

annotation { "Name" : "Round things",
             "Filter" : (GeometryType.CIRCLE || GeometryType.ARC) && SketchObject.YES,
             "MaxNumberOfPicks" : 2 }
definition.roundThings is Query;
Query in feature dialog
These filters are only applied on the client during selection; because of changes to features earlier in the feature list, the actual query passed in may evaluate to entities that do not actually pass the filters, so it is up to the feature author to check or filter the input inside the feature body. Some filters like QueryFilterCompound do not have corresponding queries.

References
Custom features often need to use geometry or data contained in other Onshape tabs. Reference parameters allow a user to select a Part Studio, image, or CSV tab to reference.

Like all Onshape references, if this other tab is in the same document, the feature will be kept up-to-date with any changes to the other tab. If the other tab is in another document, its data is kept at a version, and the feature displays a link icon which allows the user to update that version if desired.

annotation { "Name" : "Part Studio", "Filter" : PartStudioItemType.SOLID || PartStudioItemType.ENTIRE_PART_STUDIO }
definition.myPartStudio is PartStudioData;
Part Studio reference in feature dialog
A detailed overview of all types of reference parameters can be found in the FeatureScript imports documentation.

Example features using reference parameters can be found in the Reference parameter examples document.

Lookup tables
A lookup table is a UI built around specifying a parameter (or set of parameters) though a decision tree. This is similar to selecting an option from an enum value, but each option can have additional sub-options, each sub-option may have sub-sub-options, etc. A typical use is navigating to a standard size, which you can try out in Onshape's Hole feature.

An example of a feature using a lookup table is below:

const ml is ValueWithUnits = centimeter ^ 3;
const oz is ValueWithUnits = 29.5735 * ml;

export const sizeTable = {
        "name" : "region",
        "displayName" : "Region",
        "default" : "EU",
        "entries" : {
            "EU" : {
                "name" : "size",
                "displayName" : "Size",
                "default" : "Medium",
                "entries" : {
                    "Small" : 250 * ml,
                    "Medium" : 350 * ml,
                    "Large" : 500 * ml
                }
            },
            "US" : {
                "name" : "size",
                "displayName" : "Size",
                "default" : "Large",
                "entries" : {
                    "Medium" : 16 * oz,
                    "Large" : 32 * oz,
                    "Supersize" : 64 * oz
                }
            }
        }
    };

annotation { "Feature Type Name" : "Soda" }
export const soda = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Soda size", "Lookup Table" : sizeTable }
        definition.size is LookupTablePath;
    }
    {
        var size is ValueWithUnits = getLookupTable(sizeTable, definition.size);

        fCylinder(context, id + "cylinder1", {
                "bottomCenter" : vector(0, 0, 0) * inch,
                "topCenter" : vector(0, 0, 1) * size ^ (1/3),
                "radius" : size ^ (1/3) / sqrt(PI)
        });
    });
Lookup table parameter
A lookup table is a tree data structure, defined as a FeatureScript map with a specific format. The root node of the tree specifies the FeatureScript "name" of the option (in the above example, "region"), the "displayName" of the option to show in the dialog (above, "Region"), and, optionally, the "default" value of the option (above, "EU").

The root node finally specifies a map of "entries". The key of each entry is the user-visible name of that option. The value of each entry may be one of two things:

1. If more choices are needed, the entry value will be the next node of the decision tree, with the same form as the root node: a map of "name", "displayName", optional "default", and another map of "entries". 2. If no more are choices needed, the entry value will be final value of the parameter (above, the volumes of e.g. 250 * ml).
Successive nodes of the decision tree may be nested arbitrarily deep, but every possible path should terminate in a final value.

The parameter's final value may be of any form. One lookup table can specify the value of multiple parameters by setting each final value to a map of several parameters.

A parameter based on the lookup table is declared with type LookupTablePath and annotated with its associated "LookupTable". The LookupTablePath given in the definition can then be resolved to the final value of the parameter with the getLookupTable function.

Arrays
An array parameter contains a FeatureScript array of items, where each item contains one or more inner parameters. The inner parameters may be of any parameter type (though one array parameter cannot be nested inside another). A user can add any number of items to the array parameter, and may click on the item names to expand or collapse the parameters within.

annotation { "Name" : "Profiles",
    "Item name" : "Profile",
    "Item label template" : "Profile (#width)" }
definition.profiles is array;

for (var profile in definition.profiles)
{
    annotation { "Name" : "Width" }
    isLength(profile.width, LENGTH_BOUNDS);

    annotation { "Name" : "Make square" }
    profile.isSquare is boolean;
}

 Array parameter feature dialog
The value of an array parameter is an array of maps, e.g.:

[
    { "width" : 0.9 * inch, "isSquare" : false },
    { "width" : 1.2 * inch, "isSquare" : true }
]
As with any FeatureScript array, the items inside can be accessed (via definition.profiles[0] ) or iterated through (via for (var profile in definition.profiles) {} ).

The annotation for an array parameter can include the following fields:

"Item name": The name on the add button.
"Item label template": The label above each item. Computed values of the inner parameters can be included in the label using the same #parameterName syntax used in the feature name template.
"Driven query": Specifies a single inner query parameter, and makes the array parameter selection-driven. A selection-driven array parameter has no add button. Instead, when a user selects an entity, a new item is added, and that item's driven query parameter is populated with the selected entity. As long as the array parameter is focused (blue), all entities in the driven query of all items are highlighted in the graphics view. Clicking to remove a highlighted entity will remove the it from driven query parameters, and remove any newly empty items. Thus, the user's interaction with a selection-driven array parameter is very similar to their interaction with a single query parameter.
"Show labels only": Whether or not to only show the label for each item. This option removes the add button and the expander to the left of the item label, disabling the ability to add or expand and edit items. Unlike when using UIHint.READ_ONLY on an array parameter, items may still be removed, or the array may be cleared. This can be useful for an array parameter whose entries don't need to be edited manually (for example, if they're changed only in editing logic or manipulator change functions) but should still be allowed to be removed.
"UIHint": Additional UI options, which can include UIHint.COLLAPSE_ARRAY_ITEMS to create new items and present newly opened dialogs with all array items collapsed by default.
The UIHint UIHint.MATCH_LAST_ARRAY_ITEM can be used on an inner parameter to set its default value according to the last item in the current list, if it exists.

Note that inner parameter names must be unique across the entire feature (even though they are not stored directly on the definition map).

Parameter groups
Parameters can be combined into a collapsible group and can be nested. Parameter groups can be useful for simplifying large feature dialogs and for indicating which parameters belong together. To define a parameter group, enclose it in a statement block and annotate it with Group Name, e.g.:

annotation { "Group Name" : "My Group" }
{
    annotation { "Name" : "My Boolean" }
    definition.myBoolean is boolean;

    annotation { "Name" : "My Length" }
    isLength(definition.myLength, LENGTH_BOUNDS);
}
By default, when a feature dialog is opened, groups are collapsed. To override that behavior, add "Collapsed By Default" : false to the annotation. The group chevron can be put on the same line as a preceding boolean parameter by adding "Driving Parameter" : "parameterId" to the group annotation. A possible use-case is to combine this with an if statement, as follows:

annotation { "Name" : "Additional Options" }
definition.additionalOptions is boolean;

if (definition.additionalOptions)
{
    annotation { "Group Name" : "Options", "Collapsed By Default" : false, "Driving Parameter" : "additionalOptions" }
    {
        annotation { "Name" : "Option" }
        definition.option is string;
    }
}
UIHints
A parameter may have one or more "UIHint" strings specified in the annotation. For example, UIHint.OPPOSITE_DIRECTION causes a boolean to be rendered as an opposite direction button. Typically, this is used in tandem with a length parameter, as shown below:

annotation { "Name" : "Flip", "UIHint" : UIHint.OPPOSITE_DIRECTION }
definition.isFlipped is boolean;
 Opposite direction in feature dialog
Multiple hints can be specified in an array (e.g. [ UIHint.OPPOSITE_DIRECTION, UIHint.REMEMBER_PREVIOUS_VALUE ]). Most hints are type-specific, but any parameter may have UIHint.ALWAYS_HIDDEN to prevent it from ever appearing in the dialog. This can be useful for keeping hidden state in the definition for use by manipulators or editing logic.

Some values are intended for Onshape internal use. These may not work or may change behavior in future versions. The UIHint enum in the Standard Library contains more information on this as well as the full set of available options.

Conditional visibility
Some parameters only make sense for certain settings of other parameters. To express this, the specifications for conditionally visible parameters can be put in if statements referencing already specified parameters. For example:

    ...
    precondition
    {
        definition.useCustomLength is boolean;
        if (definition.useCustomLength)
            isLength(definition.customLength, LENGTH_BOUNDS);
    }
    ...
The conditions for the if statements may include comparisons of prior boolean and enum parameters to fixed values using == and !=. They may also include the logical operators &&, ||, and !. The if statements may be nested.

A current limitation is that a parameter specification can only appear once per feature, and so, for example, cannot appear with different annotations in different branches of an if statement. If this behavior is desired, we recommend you use two different parameter names, and merge them inside the function.

Description
A description can be added to a feature or parameter through the ”Feature Type Description” or ”Description” fields (respectively) in the annotation map.

Descriptions are displayed in the "Search Tools" panel and in the feature/parameter tooltip.

Descriptions can be split up into multiple lines using the ~ operator, and their content can contain basic HTML tags, but not images or external links.

annotation { "Feature Type Name" : "Slot",
             "Feature Type Description" : "Creates a rectangular slot in a selected part.<br>" ~
                                          "This feature is an <b>example</b>"
 }
export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
            annotation { "Name" : "Slot length",
                         "Description" : "Distance from the slot's end to its furthest extent along the outside of the part" }
            isLength(definition.slotLength, LENGTH_BOUNDS);
    }
...
Feature description display Parameter description display
Icons
A custom feature icon is specified by uploading the icon as an SVG blob tab and referencing it:

IconNamespace::import(...);

annotation { "Feature Type Name" : "MyFeature", "Icon" : IconNamespace::BLOB_DATA }
export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)
...
An enum or quantity parameter icon is specified analogously:

annotation { "Name" : "My Length", "Icon" : IconNamespace::BLOB_DATA }
isLength(definition.myLength, LENGTH_BOUNDS);
 Quantity with icon
Feature icons are displayed in grayscale to be consistent with our standard feature icons, whereas parameter icons allow color.

It is also possible to reference parameter icons that are used by the standard Onshape features. Instead of specifying an imported blob resource, an entry in the Icon enum may be used as the value of any "Icon" annotation field, as in the example below, which adds icons to the values of an enum parameter:

export enum AxisEnum {
    annotation { "Name" : "Along X", "Icon" : Icon.ALONG_X }
    ALONG_X,
    annotation { "Name" : "Along Y", "Icon" : Icon.ALONG_Y }
    ALONG_Y,
    annotation { "Name" : "Along Z", "Icon" : Icon.ALONG_Z }
    ALONG_Z
}
...
annotation { "Name" : "Axis" }
definition.axis is AxisEnum;
 Enum values with icons
Description images
A custom feature description image is specified by uploading the image as a JPG, PNG, or SVG blob tab and referencing it:

ImageNamespace::import(...);

annotation { "Feature Type Name" : "MyFeature", "Description Image" : ImageNamespace::BLOB_DATA }
export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)
...
The example below demonstrates the Fillet Everything custom feature with a "Description", an "Icon", and a screen capture of the feature in the Part Studio display imported into the document for reuse as the feature's "Description Image".

Feature description image display in toolip Feature description image display in Search panel
Feature description images are displayed following the feature description in the feature tooltip and in the "Search Tools" panel. Features can have description images, but unlike icons, parameters cannot. The description image will be displayed in its native size if possible, but will be shrunk uniformly to fit in the two areas it is displayed. Both areas are typically close to 300px by 300px, so images near that size work well.

Manipulator change function
The manipulator change function allows you to specify manipulator behavior in a very flexible way. It is typically declared as:

export function onManipulatorChange(context is Context, definition is map, newManipulators is map) returns map
{
    // modify the definition based on what's in newManipulators
    ...

    return definition;
}
The idea is that when the feature regenerates, it defines some manipulators using addManipulators to be shown on the screen. When a user drags one of these manipulators, the manipulator change function gets called. It can look at the context, the feature definition, and the manipulator changes, and change the feature definition in response. Thus, a manipulator does not have to be tied to a particular parameter and could modify a group of parameters all at once.

See the manipulator module for a simple example.

Manipulator change function arguments
The context is passed in at a state immediately prior to the feature. After the manipulator change function is executed, it will be rolled back to that same state, so changes made to the context will not persist.
The definition map is almost exactly as passed into the feature function. The difference is that if the feature specifies programmatic defaults for some parameters, they will not be applied prior to the manipulator change function call.
The newManipulators map has exactly one entry. The key is one of the manipulator id strings that were passed into the addManipulators function when the feature regenerated. The value is a Manipulator that corresponds to the new value of the manipulator; it's the same as the value that was passed into addManipulators during regeneration, with the exception of some parameters that change as a result of the manipulator interaction:
offset for the LINEAR_1D and LINEAR_3D (triad) manipulators
angle for the ANGULAR manipulator
flipped for the FLIP manipulator
transform for the TRIAD_FULL manipulator
Manipulator change function return value
The return value is a map like definition with some of the parameters modified. The parameter types that can be changed are:

Boolean
String
Enum
Query
LookupTablePath
Quantity: can be specified either as a value (ValueWithUnits if appropriate) or, unless the quantity is isAnything, as a string. If a string is used, Onshape will set the expression for the quantity to that string. For instance, the returned definition might include width : "3/8 in" so that the user sees that instead of "0.375 in".
Editing logic function
If an editing logic function is specified, it is called whenever the feature definition is changed either explicitly by the user or with a manipulator (but see isCreating in arguments). It can make additional feature definition changes based on the context and the users' edits. The editing logic function is primarily intended for setting default parameters in an intelligent manner.

For example, the modifyFillet feature in std/modifyFillet.fs uses it to set the fillet radius based on the current radius of the selected fillet. The extrude feature uses it to set the opposite direction parameter as well as the boolean merge scope. The cPlane feature uses it to set the plane type based on the preselection.

A word of caution: it is easy to abuse the editing logic function to create a user experience that is more annoying than helpful. Enjoy editing logic responsibly.

Editing logic function arguments
An editing logic function may have between four and seven arguments. A declaration with seven arguments looks like:

export function onFeatureChange(context is Context, id is Id, oldDefinition is map, definition is map,
                                isCreating is boolean, specifiedParameters is map, hiddenBodies is Query) returns map
{
    // modify the definition
    ...

    return definition;
}
The first four arguments are required.

The context is passed in at a state immediately prior to the feature. After the editing logic function is executed, it will be rolled back to that same state, so changes made to the context will not persist.
The id is the feature id in question.
The oldDefinition map is the feature definition prior to the changes that caused the editing logic function to be invoked. If the feature specifies programmatic defaults for some parameters, they will not be applied prior to the editing logic function call.
The definition map is the feature definition that includes the changes that caused the editing logic function to be invoked. As above, defaults are not applied. A no-op editing logic function just returns the unmodified definition. The editing logic function can tell if a parameter has been changed by comparing its value in definition and oldDefinition.
Any (or all) of the remaining three arguments may be omitted, but those that remain must appear in the same order relative to each other. Omitting unused arguments may result in better performance.

The isCreating boolean is set to true if the feature is being created and false if it is being edited, having been committed at least once. Note: If isCreating is omitted, the editing logic function will only be called when the feature is being created.
The specifiedParameters map indicates which parameters have been set by the user since the feature dialog opened. The ids of those parameters that have been specified map to true and those that have not map to false.
The hiddenBodies query evaluates to all of the bodies have been hidden by the user (that information is not accessible from the context). It is used for example to avoid automatically adding invisible bodies to an extrude merge scope.
The clickedButton string indicates which button parameter was clicked to trigger the editing logic function. If no button was clicked, clickedButton is the empty string.
Editing logic function return value
The return value is a map following the same rules as the return value for the manipulator change function.