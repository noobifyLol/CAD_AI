FeatureScript custom tables can be used to display useful data in Part Studios.

A custom table type, like a custom feature type, is defined with FeatureScript code in a Feature Studio, and can be used in any Part Studio. The table type defines a function to run on a fully regenerated Part Studio, which produces either a Table (to show one table) or a TableArray (to show multiple). This output is displayed as a read-only table, which can be accessed anywhere by a user who has added the table type to their tables.

For example, the table type definition below returns a single table listing the volume of every part.

annotation { "Table Type Name" : "Part volumes" }
export const partVolumes = defineTable(function(context is Context, definition is map) returns Table
    precondition
    {
    }
    {
        var columns = [tableColumnDefinition("name", "Part name"),
                       tableColumnDefinition("volume", "Volume")];

        var rows = [];
        for (var part in evaluateQuery(context, qAllModifiableSolidBodies()))
        {
            var partName = getProperty(context, { "entity" : part, "propertyType" : PropertyType.NAME } );
            var volume = evVolume(context, { "entities" : part });
            rows = append(rows, tableRow({ "name" : partName, "volume" : volume }));
        }

        return table("Part volumes", columns, rows);
    });
Custom table displaying part volumes

The table function can access any data that a custom feature can access: all geometry of the Part Studio, all its variables, all its attributes, as well as any FeatureScript functionality from in the Onshape Standard Library or other Feature Studios. Additionally, from a table function, you can use the getProperty() function to access the values of any part properties.

Onshape hole table

The Onshape hole table is a table type defined in the Onshape Standard Library. Just like Onshape's standard features are implemented using the same FeatureScript functionality custom features have access to, Part Studio hole tables are implemented using the functionality available to custom tables.

Table content
A table consists of rows and columns. Column definitions are constructed with the tableColumnDefinition(...) functions, which define an internal id, the user-facing name of the column, and a cell alignment for the column (left, right, or center).

Rows are constructed with the tableRow(...) functions, whose columnIdToCell arguments set the contents of all the row's cells. The keys in the columnIdToCell map should match the ids of the table columns (though columns can be skipped to leave cells blank).

The value in each cell may be any of the following:

String : Any string will be displayed as-is inside the table cell
ValueWithUnits : Will be displayed in the cell in a human readable format (e.g. 1.23 in) with the precision and units of the end user's document workspace.
TemplateString : Values with units may be inserted into template strings, so that they may still be shown with the correct precision and units while being part of other text in the cell. For example, a cell value of templateString("diam = #d", { "d" : someDiameter }) might display as "diam = 1.23 in" in a workspace with inch units.
TableCellError : In the event of unexpected or problematic geometry, a table cell may be displayed with a red background by passing in e.g. tableCellError("bad value", "Bad value encountered"). The second argument is displayed in a tooltip when hovering over the erroneous cell, and either argument may be a TemplateString.
Values with units and TemplateStrings may also be used in the table title and column names.
Cross-highlighting
Rows and/or columns may be given entities to cross-highlight in their constructors. These entities will be highlighted when a user hovers their mouse over the table cells. Additionally, table rows will highlight when the user hovers over its entities, and will scroll to the relevant entities when they are selected.

Printing
For debugging purposes, a table may also be output as a string in the FeatureScript console, which will format the table in a human-readable fashion:

println(table("Part volumes", columns, rows));
Table parameters
Like custom features, custom tables can be defined with input parameters. They are defined the same way that custom feature inputs are defined, but are limited to booleans, strings, enums, and quantities.

For example, the precondition of the table type below allows the user to set their own threshold for detecting small fillet radii, and optionally allows computing the size of the geometry being listed:

precondition
{
    annotation { "Name" : "Minimum fillet radius" }
    isLength(definition.minimumFilletRadius, NONNEGATIVE_ZERO_DEFAULT_LENGTH_BOUNDS);

    annotation { "Name" : "Calculate size" }
    definition.calculateSize is boolean;
}
Custom table inputs

Like custom features, custom tables are fully recomputed each time one of these inputs changes.

Using custom tables with custom features
It is often useful to show data from custom features in a custom table. For instance, the FeatureScript Spur Gear feature is defined in the same document as a custom table which displays data about the gears that have been created: Gear table

These measurements displayed are all either parameters of the spur gear feature, or are computed while running the spur gear feature. To avoid extra work and inaccuracy from measuring these gears at the end of regeneration, the Spur Gear feature simply sets attributes on the gear parts created. The Gears table can read these attributes and display them in a table.