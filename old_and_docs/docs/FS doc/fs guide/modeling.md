Context
A context is a builtin that stores modeling data, including bodies (solid, sheet, wire, and point), their constituent entities (faces, edges, and vertices), variables, feature error states, etc. All features, operations, and evaluation functions require a context to operate on.

For more information, see the context module.

Bodies
The geometry in a context is grouped into independent bodies. A body is comprised of zero or more vertices, faces, and edges and may represent a 3D (solid), 2D (sheet), 1D (wire), or 0D (point) region. A cylinder, for example, is a solid body with no vertices, two edges, and three faces. A construction plane is a special type of sheet body with one face. A body is always connected: for example, two disjoint volumes or surfaces cannot be a single body.

Bodies, vertices, edges, and faces are collectively referred to as "entities". Every face, edge, and vertex belongs to a body. The typical result of regenerating a Part Studio is creating bodies in its context.

Queries
Queries are used to refer to topological entities (vertices, edges, faces, and bodies) in a context. You can think of a Query as an order form for geometry, specifying criteria that said geometry must satisfy. For instance, qCreatedBy specifies geometry created during a certain operation. qContainsPoint specifies geometry that touches a specified point. These queries can be combined and nested into bigger or more specific queries.

A query does not reference entities, it simply encodes criteria. However, when passed into a function (like an evaluation or an operation) together with a context, that function can determine which entities match the query.

In general, the functions you use will take care of evaluating which entities match a query. However, sometimes it is necessary to determine how many entities match a query, or perform a loop over each match. In this situation, you can use evaluateQuery, which returns an array of transient queries – one for each entity in the context matching the query at the time it was evaluated.

FeatureScript uses queries in place of direct references out of a need for robustness in the face of changes earlier in the feature list. When we reference the top of a cube, we need to be able to find that face again after the user changed the cube's size and drilled a hole through it.

The full set of available query functions can be found in the query module.

Evaluations
Evaluation functions are used to measure the geometry and topology in a context. They start with ev and take two arguments: a Context and a map that specifies what to measure. For example, evBox3d and evVolume respectively find the bounding box and the volume of a group of entities, while evVertexPoint returns a 3D position Vector for a vertex.

The full set of available evaluation functions can be found in the evaluate module.

Operations
Operations are standard library functions that create or modify geometry in a context. They start with op and take three arguments: a Context, an operation Id, and a definition map. A feature may have no operations (like assignVariable), one operation (like fillet calls opFillet), or multiple operations (like extrude, which may call opExtrude, opDraft, opBoolean and more).

Operations modify the context which is passed in, potentially creating, deleting, or changing its entities. This modification is tracked in Onshape with a unique Id. For more on operation ids, see the Id type documentation

The full set of available operation functions can be found in the geomOperations module.

Primitives
Primitives are elementary operations like fCuboid and fCylinder which quickly create simple 3D solid bodies.

The full set of available primitive-creating functions can be found in the primitives module.

Sketches
Sketches can be created inside of custom features as final products or as a step toward building new geometry.

The typical way of creating sketches from within a feature is different from the typical way of creating sketches interactively in two important ways:

When creating a sketch from FeatureScript, full control over the sketch coordinate system is important. The newSketchOnPlane function creates a sketch whose coordinate system is derived from that of the passed in plane, while the newSketch function (called from Part Studios) uses a canonical coordinate system.
Sketches created from FeatureScript often don't need to make use of constraints (although they can if necessary) because it is often easier to calculate the desired sketch entity coordinates in FeatureScript than to set up the correct constraint system. The skSolve call is still necessary to generate sketch geometry.
Advanced sketch functionality, like sketch offset, sketch fillet, etc., is not available in FeatureScript. Some of these gaps can be worked around by extruding a solid body from the sketch and using operations like opThicken or opFillet.

An example of creating and solving a sketch, along with the full set of sketch functions, can be found in the sketch module.

Geometry
As writing features often involves geometric computation, the standard library provides types and functions to make it easier. There are types to represent points, curves (such as lines and circles), surfaces (planes, cylinders, cones), coordinate systems, and transforms. These are FeatureScript values and should not be confused with entities living in a context. For instance, Vector, Line, Plane, and CoordSystem are types and roughly corresponding respective entities are a vertex, a line edge, a planar face (or a construction plane), and a mate connector. Evaluation functions return geometric types (e.g., evVertexPoint) and operations can create entities from some geometric types (e.g., opPoint).

An issue that often arises when writing geometric code is round-off error in floating-point. We recommend that for comparing geometric objects, you use the tolerantEquals method instead of the builtin == operator (that does an exact comparison). Keep in mind that while tolerantEquals tries to use reasonable tolerances (1e-8 meters for length, 1e-11 radians for angle), they may not be right for your specific application (and there is no general right answer), but they will work well in most cases.

Feature Patterns
Feature patterns will not automatically work correctly with custom features because different features need to apply the pattern transform differently. To help figure out the right transform to apply, the standard library provides the function getRemainderPatternTransform. See its documentation for more information about feature patterns and how to write features that work with them.