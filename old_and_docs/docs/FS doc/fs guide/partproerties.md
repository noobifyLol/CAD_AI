Computed part properties are properties whose values are computed using FeatureScript functions. These properties are available wherever Part properties are available, like BOMs and drawings. Rather than being manually set to a static value, they are computed from a custom FeatureScript function. The FeatureScript function can compute the property value with access the full Part Studio context, including geometry of the Part, its attributes, its non-computed properties, and Part Studio variables.

Standard computed part properties like Mass are available to everyone, while custom computed part properties you define can be made available to your company.

Defining computed part properties
The following sections provide a step by step guide to creating, testing, and using computed part properties.

Define the property function
Property functions can be defined in any Feature Studio, though it may be useful to create a separate document for your company's property functions.

The following FeatureScript snippet defines a simple property function that will compute the volume of a part.

annotation { "Property Function Name" : "computeVolume" }
export const computeVolume = defineComputedPartProperty(
             function(context is Context, part is Query, definition is map) returns ValueWithUnits
    {
        return evVolume(context, { "entities" : part });
    });
The import onshape/std/common.fs has everything you typically need for defining property functions. Importing geometry.fs by property function Feature Studios is discouraged for performance reasons.

The Property Function Name annotation and the use of defineComputedPropertyFunction identify the function as a computed part property function. Both are essential. When you start to type defineComputed in the FeatureScript editor, you can autocomplete to a template for your property function.

Computed part property functions must specify a FeatureScript return type, which must be one of:

string
number
boolean
ValueWithUnits
Your property functions have access to the full power of FeatureScript: all geometry of the part, and all FeatureScript functionality from the Onshape Standard Library or other Feature Studios, including access to non-computed properties using the getProperty() function. Computed part property functions cannot use other computed part properties using getProperty(), but they can call other functions including other property functions.

Test the property function
Onshape generates custom tables for your computed part property functions that you can use in the same workspace in which you define the property functions. To use this feature, create some parts in a Part Studio in the same workspace, and then select the appropriate custom table from the custom tables tab.

Feature studio showing generated custom tables

If there are errors, they will appear in the FeatureScript notices ({!}) in the Part Studio. If that happens, you can monitor the Part Studio from the Feature Studio where you defined the property functions, and fix the errors from there.

Outside of this workflow, runtime errors in computed property functions are not visible in the FeatureScript notices to users viewing the properties. Thus, it is generally not recommended to throw errors inside custom property functions, or to leave errors in called functions uncaught, even in cases where the property is clearly not applicable.

Create a document version
Property functions are versioned by the document version of their Feature Studio, so you need to commit the Feature Studio and create a document version to refer to the version you want from your custom property.

Don't forget to create a new document version when you change your property functions, and then edit the custom property in your company's setting to use the new version.

Define the custom property
Custom computed part properties are defined like other custom properties in the custom properties section of your company settings. In order to associate a custom property with a property function, making it into a computed part property, the following are required:

The property type must be one of Text, Double, Boolean, or Value with units, corresponding to the FeatureScript types listed above.
The property's categories must include Part.
The property will need to be active in order to use it.
Note that the Edit value in workspace and Edit value in version checkboxes affect when a computed part property can be overridden. The default is for it to be computed.

When the above conditions are met, a Computed part properties section appears in the property details form. From there, you can select a property function by document, version, feature studio, and function name. You can use the features of the selection dialog to navigate to other documents and versions as needed.

Property details showing function selection dialog

Once a property function has been selected, the Property function source field will contain a link that will open the right version of the feature studio in a new tab.

Using computed part properties
Using computed part properties in the properties dialog
Computed part properties are included in the properties dialog when you request properties for parts. Computed properties have a script f after their names, and will also have an Override checkbox if they can be overridden in the properties dialog.

Properties dialog showing computed part properties

To override a computed value, check the Override checkbox and enter the override value. To remove an override and use the computed value, uncheck the Override checkbox. When removing an override, the dialog will display Computed until you click Apply, and then the computed value will be computed and displayed.

Using computed part properties in a bill of materials
You can add computed part properties to a bill of materials using the Add column dropdown. You can override computed part properties in the BOM by editing the cells. If a table cell contains an override, it will display a hover tooltip indicating that it is an overridden computed property. You can remove the override using the Remove override context menu item from the table cell.

Adding computed part properties to a bill of materials will increase the time required to display the table if previously computed values are not available in a runtime cache.

Using computed part properties in configured part properties
You can add computed part properties to the configured properties table in a part studio using the Add property dropdown. Similar to a bill of materials, you can provide configuration specific values for computed properties by editing their values in the table. You can also remove a configured value from a table cell using the Remove configured value context menu from the table cell.

Table cells for computed part properties that do not have configured override values display Computed rather than the actual computed values because computing property values for multiple configurations is computationally expensive.