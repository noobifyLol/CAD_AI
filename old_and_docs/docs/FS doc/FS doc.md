[text](https://cad.onshape.com/FsDoc/)

Modeling
geometry
This module makes all Onshape Standard Library features and functions available.

New Feature Studios begin with an import of this module,

import(path : "onshape/std/geometry.fs", version : "");
with current version inserted (e.g. 300.0). This gives that Feature Studio access to all functions, types, enums, and constants defined in the Onshape Standard Library.

common
This module makes most common Onshape Standard Library functions available. It can be imported in place of geometry.fs,

import(path : "onshape/std/common.fs", version : "");
into Feature Studios that do not require the full set of Onshape Standard Library features.

context
Context type

A Context is a builtin that stores modeling data, including bodies (solids, sheets, wires, and points), their constituent topological entities (faces, edges, and vertices), variables, feature error states, etc.

Every Onshape Part Studio uses a single Context. All features, operations, and evaluation functions require a context to operate on. Different contexts do not interact, but data may be transferred from one to another using opMergeContexts.

Each context keeps track of the version of the Onshape Standard Library at which it was created. While regenerating a feature that has been "held back" to an older version, the version reported by the context will be the older version, causing subfeatures and operations to emulate old behavior.

canBeContext (value) predicate

Typecheck for Context

isAtVersionOrLater (versionToCheck is FeatureScriptVersionNumber, versionToCompareAgainst is FeatureScriptVersionNumber) returns boolean

isAtInitialMixedModelingReleaseVersionOrLater (context is Context) returns boolean

Returns true if at or after mixed modeling release version.

Id type

An Id identifies a feature or operation in a context. Each feature, subfeature, and operation must have a unique id. Ids are used in queries, error reporting, and accessing data associated with features.

Ids are hierarchical. That is, each operation's id must have a parent id. The root id is constructed with newId() and subIds are added with the overloaded + operator.

EXAMPLE

id + "foo" represents an id named "foo" whose parent is id
EXAMPLE

id + "foo" + "bar" represents an id named "bar" whose parent equals id + "foo"
Internally, an Id is just an array whose elements are strings, representing the full path of the Id.

EXAMPLE

newId() + "foo" + "bar" is equivalent to ["foo", "bar"] as Id, though the expressions like the latter are not recommended in practice.
Within a feature, all operations' ids should be children of the feature's Id (which is always passed into the feature function as the variable id).

Subfeatures should use a similar pattern. For instance, in the snippet below, mySubfeature is a minimal example following good practices for breaking out a set of operations into a subroutine.

annotation { "Feature Type Name" : "My Feature" }
export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "startingCube", {
                "corner1" : vector(0, 0, 0) * inch,
                "corner2" : vector(1, 1, 1) * inch
        });
        mySubfeature(context, id + "subFeature", qCreatedBy(id + "startingCube", EntityType.EDGE));
        fCuboid(context, id + "endingCube", {
                "corner1" : vector(0, 0, 0) * inch,
                "corner2" : vector(-1, -1, -1) * inch
        });
    }, {});
function mySubfeature(context is Context, id is Id, entities is Query)
{
    opChamfer(context, id + "chamfer", {
            "entities" : entities,
            "chamferType" : ChamferType.EQUAL_OFFSETS,
            "width" : 0.1 * inch
    });
    opFillet(context, id + "fillet1", {
        "entities" : qCreatedBy(id + "chamfer", EntityType.EDGE),
        "radius" : 0.05 * inch
    });
}
The full id hierarchy must reflect creation history. That is, each Id (including parents) must refer to a contiguous region of operations on the context.

Thus, the following code will fail because id + "extrude" alone refers to two non-contiguous regions of history:

for (var i in [1, 2])
{
    opExtrude(context, id + "extrude" + i, {...}); // Fails on second iteration.
    opChamfer(context, id + "chamfer" + i, {...});
}
For the above code, a pattern like id + i + "extrude" or id + ("loop" ~ i) + "extrude" would work as expected, as would the unnested id + ("extrude" ~ i).

Only the following characters are allowed in a string that makes up an Id: a-z, A-Z, 0-9, _, +, -, /. An asterisk * is allowed at the beginning of the string to mark it an "unstable" component (see below).

canBeId (value) predicate

Typecheck for Id

newId () returns Id

Returns an empty id.

makeId (idComp is string) returns Id

Returns an id specified by the given string.

isTopLevelId (id is Id) predicate

True if the Id represents a top-level feature or default geometry (i.e. if the Id has length 1)

ANY_ID const

The string literal "*", which matches any id inside certain queries.

EXAMPLE

qCreatedBy(id + ANY_ID + "fillet")
unstableIdComponent (addend) returns string

Marks a given id component as "unstable" causing queries to treat it as a wildcard. This is useful for when the id component is not expected to be robust, such as an index into the results of an evaluated query.

setVariable (context is Context, name is string, value)

Attach a variable to the context, which can be retrieved by another feature defined later. If a variable of the same name already exists, this function will overwrite it.

EXAMPLE

setVariable(context, "foo", 1) attaches a variable named "foo", with value set to 1, on the context.
Parameter	Type	Additional Info
value		
Can be any value, including an array or map with many elements.

setVariable (context is Context, name is string, value, description is string)

Attach a variable with a description to the context, which can be retrieved by another feature defined later. If a variable of the same name already exists, this function will overwrite it.

EXAMPLE

setVariable(context, "foo", 1, "the foo") attaches a variable named "foo", with value set to 1 and the description set to "the foo", on the context.
Parameter	Type	Additional Info
value		
Can be any value, including an array or map with many elements.

description	string	
A string describing the use or purpose of the variable.

getVariable (context is Context, name is string)

Retrieve a variable attached to the context by name. Throws an exception if variable by the given name is not found.

EXAMPLE

getVariable(context, "foo") returns the value assigned to a previously-set variable named "foo".
Variables on a context can also be accessed within a Part Studio using # syntax (e.g. #foo) inside any parameter which allows an expression.

getVariable (context is Context, name is string, defaultValue)

Retrieve a variable attached to the context by name. If variable by the given name is not found, returns defaultValue

EXAMPLE

getVariable(context, "foo", {}) returns the value assigned to a previously-set variable named "foo". If not found returns empty map.
libraryLanguageVersion ()

Returns the language version of the library. Note: this function calls @getLanguageVersion internally, but if you call @getLanguageVersion directly, you may get a different result. That is because @getLanguageVersion returns the language version of the module making the call (which, for a module in std will coincide with the version of std.)

geomOperations
Operations are the basic modeling primitives of FeatureScript. Operations can do extrusion, filleting, transforms, etc. An operation takes a context, an id, and a definition and modifies the context in accordance with the definition. The modifications can be referenced by the passed-in id. Operations return undefined but can fail by throwing an error or they can report warnings or infos. The status can be read with the getFeature... functions in error.fs.

When an operation parameter that requires one entity receives a query that resolves to multiple entities, it takes the first resolved entity.

The geomOperations.fs module contains wrappers around built-in Onshape operations and no actual logic.

opMoveCurveBoundary (context is Context, id is Id, definition is map)

Trims or extends a wire body to an entity or by a distance.

Parameter	Type	Additional Info
definition	map	
wires
Query	
The wire bodies to modify.

moveBoundaryType
MoveCurveBoundaryType	
Optional

Whether to trim or extend. Default is TRIM.

trimTo
Query	
Required if moveBoundaryType is TRIM.

Single entity to trim wires to.

endCondition
CurveExtensionEndCondition	
Optional

If moveBoundaryType is EXTEND defines whether to extend wires by a distance of to an entity. Default is BLIND.

extensionDistance
ValueWithUnits	
Required if endCondition is BLIND

Distance to extend wires.

extendTo
Query	
Required if endCondition is BLIND

Single entity to extend wires to.

extensionShape
CurveExtensionShape	
Optional

Specifies how to transition into the curve extensions. Default is SOFT.

helpPoint
Query	
Required if endCondition is BLIND

Specifies vertex used to choose a solution. If this is not provided, the closest vertex to the bounding entity will be used.

flipHeuristics
boolean	
Optional

If true, will trim or extend from the opposite end of wires. Default is false.

opBodyDraft (context is Context, id is Id, definition is map)

Apply draft to a part by adding material. The material is added between reference edges and a parting object. These reference edges can be supplied directly, or they can be inferred from face or part queries.

Parameter	Type	Additional Info
definition	map	
selectionType
BodyDraftSelectionType	
Optional

Topology class for input. Default is EDGES

topEdges
Query	
Required if selectionType is EDGES

Edges to draft above parting entity.

bottomEdges
Query	
Required if selectionType is EDGES and bothSides is true

Edges to draft with angleBelow.

faces
Query	
Required if selectionType is FACES

Faces to draft. This will split the face with isoclines those for the draft. Additionally, any existing edges bounding faces will be used if they mark a transition from steep faces to non-steep faces for the given pull direction and draft angle.

bodies
Query	
Required if selectionType is PARTS

Parts to draft. This is equivalent to supplying all faces of the part in faces.

excludeFaces
Query	
Optional

Faces of bodies to exclude from drafting.

angle
ValueWithUnits	
The draft angle above the parting object.

bothSides
boolean	
Optional

If true, draft on both sides of the parting object. Default is false.

pullDirection
ValueWithUnits	
The pull direction.

draftOnSelf
boolean	
Optional

If true, then using the drafted part as the parting object. Default is false.

partingObject
Required if draftOnSelf is false

A surface from surfaceGeometry.fs or a query to a face or sheet body.

matchFacesAtParting
boolean	
Optional

If true, then additional material will be added to make the top and bottom of the draft align. Default is false.

matchFaceType
BodyDraftMatchFaceType	
Optional

How to add material for matchFacesAtParting Default is REFERENCE_EDGE.

cornerType
BodyDraftCornerType	
Optional

The corner treatment to apply. Default is EXTEND.

concaveRepair
BodyDraftConcaveRepairType	
Optional

How to resolve intersecting draft faces. Default is NONE.

concaveRepairRadius
ValueWithUnits	
Required if concaveRepair is RADIUS or MIX.

The radius for intersection repair.

keepMaterial
boolean	
Optional

If true, an attempt will be made to keep the regions of the part protruding from the tapered faces. Default is false.

showRefs
boolean	
Optional

If true, then debug data will be generated to show the parting surface and draft edges.

opBoolean (context is Context, id is Id, definition is map)

Performs a boolean operation on multiple solid and surface bodies.

See also

processNewBodyIfNeeded for merging new solids.

joinSurfaceBodiesWithAutoMatching for merging new surfaces.

Parameter	Type	Additional Info
definition	map	
tools
Query	
The tool bodies.

targets
Query	
Required if OperationType is SUBTRACTION or SUBTRACT_COMPLEMENT, or if targetsAndToolsNeedGrouping is true.

The target bodies.

operationType
BooleanOperationType	
The boolean operation to perform.

EXAMPLE

BooleanOperationType.UNION will merge any tool bodies that intersect or abut. All tool bodies have to be of the same type (solid or surface). When operating on surfaces, surfaces must have coincident or overlapping edges. When several bodies merge, the identity of the tool that appears earliest in the query is preserved (in particular, body color and body name are taken from it).
EXAMPLE

BooleanOperationType.SUBTRACTION will remove the union of all tools bodies from every target body. All tool bodies must be solid bodies. Target bodies could be either solids or surfaces.
EXAMPLE

BooleanOperationType.INTERSECTION will create the intersection of all tool bodies. All bodies must be solid bodies.
EXAMPLE

BooleanOperationType.SUBTRACT_COMPLEMENT will remove the complement of the union of all tool bodies from every target body. All tool bodies must be solid bodies. Target bodies could be either solids or surfaces.
targetsAndToolsNeedGrouping
boolean	
Optional

This option is for adjusting the behavior to be more suitable for doing the boolean as part of a body-creating feature (such as extrude). Default is false.

keepTools
boolean	
Optional

If true, the tools do not get consumed by the operation. Default is false.

makeSolid
boolean	
Optional

In case of surface union try to join surfaces into a solid. Default is false.

opBoundarySurface (context is Context, id is Id, definition is map)

Creates a boundary surface fitting two ordered sets of profiles.

Parameter	Type	Additional Info
definition	map	
uProfileSubqueries
array	
An ordered array of two or fewer queries for the profiles in the u direction. These can be edges or wire bodies.

EXAMPLE

[ profileQuery1, profileQuery2 ]
vProfileSubqueries
array	
Optional

An ordered array of two or fewer queries for the profiles in the v direction. These can be edges or wire bodies.

EXAMPLE

[ profileQuery1, profileQuery2 ]
uDerivativeInfo
array	
Optional

An array of maps that contain shape constraints at start and end profiles. Each map entry is required to have a profileIndex that refers to the affected profile. Optional fields include a vector to match surface tangent to, a magnitude, and booleans for matching tangents or curvature derived from faces adjacent to affected profile.

EXAMPLE

[ { "profileIndex" : 0, "vector" : vector(1, 0, 0), "magnitude" : 2., "tangentToPlane" : true}, { "profileIndex" : 1, "adjacentFaces" : qFaces } ] The first map would constrain the resulting boundary surface at the first u profile to be tangent to plane with normal vector(1,0,0) and magnitude 2. The second map constrains the boundary surface at the second u profile to match tangents of faces defined by the query qFaces.
vDerivativeInfo
array	
Optional

An array of maps analogous to uDerivativeInfo, but for v profiles.

showIsocurves
boolean	
Optional

Show graphical representation of a subset of isoparameteric curves on each face of the created boundary surface. Default false.

curveCount
number	
Optional

When showIsocurves is true, the number of curves to draw in each direction of each face's grid. Default 10.

opCreateBSplineCurve (context is Context, id is Id, definition is map)

Generates a wire body given a BSplineCurve definition. The spline must have dimension of 3 and be G1-continuous.

Parameter	Type	Additional Info
definition	map	
bSplineCurve
BSplineCurve	
The definition of the spline.

opCreateBSplineSurface (context is Context, id is Id, definition is map)

Generates a sheet body given a BSplineSurface definition. The spline must have dimension of 3 and be G1-continuous.

Parameter	Type	Additional Info
definition	map	
bSplineSurface
BSplineSurface	
The definition of the spline surface.

boundaryBSplineCurves
array	
Optional

An array of BSplineCurves defined in the parameter space of bSplineSurface to use as the boundary of the created sheet body. The boundary must form a single closed loop on the surface. The dimension of each curve must be 2, as the boundaries are being defined in UV space of the created surface. If no boundary is supplied, the created sheet body will cover the full parameter range of bSplineSurface.

makeSolid
boolean	
Optional

When set to true, the operation will produce a solid instead of a sheet if the surface encloses a region. Default is false.

opCreateCompositePart (context is Context, id is Id, definition is map)

Create a composite part.

Parameter	Type	Additional Info
definition	map	
bodies
Query	
Bodies from which to create the composite part. .

closed
boolean	
Optional

A closed composite part consumes its constituent bodies, so that they are not available interactively for individual selection. Default is false.

opModifyCompositePart (context is Context, id is Id, definition is map)

Modifies a composite part.

Parameter	Type	Additional Info
definition	map	
composite
Query	
Existing composite part to modify.

toAdd
Query	
Bodies to add to the composite part.

toRemove
Query	
Bodies to remove from the composite part.

opChamfer (context is Context, id is Id, definition is map)

Adds a chamfer to given edges and faces.

Parameter	Type	Additional Info
definition	map	
entities
Query	
Edges and faces to chamfer.

chamferType
ChamferType	
Determines where the new edges of the chamfer are positioned.

EXAMPLE

ChamferType.EQUAL_OFFSETS places both new edges width away from each original edge.
EXAMPLE

ChamferType.TWO_OFFSETS places edges width1 and width2 away.
EXAMPLE

ChamferType.OFFSET_ANGLE places one edge width away, and chamfers at an angle from that edge.
width
ValueWithUnits	
Required if chamferType is EQUAL_OFFSETS or OFFSET_ANGLE.

EXAMPLE

0.2 * inch
width1
ValueWithUnits	
Required if chamferType is TWO_OFFSETS.

width2
ValueWithUnits	
Required if chamferType is TWO_OFFSETS.

angle
ValueWithUnits	
Required if chamferType is OFFSET_ANGLE.

oppositeDirection
boolean	
Required if chamferType is OFFSET_ANGLE or TWO_OFFSETS.

true to reverse the two edges.

tangentPropagation
boolean	
Optional

true to propagate the chamfer along edges tangent to those passed in. Defaults to false.

opConstrainedSurface (context is Context, id is Id, definition is map)

Creates a constrained surface from the points.

Parameter	Type	Additional Info
definition	map	
points
array	
An array of maps containing: point (Vector) : The position of the point we want the surface to pass through. normal (Vector) (Optional) : The direction of the normal of the surface at this point.

tolerance
ValueWithUnits	
Optional

The distance the surface is allowed to deviate from the given points. Default is 1e-6 meter.

smooth
boolean	
Optional

If true, the surface will be optimized for smoothness. If false, it will be optimized for performance. Default is false.

references
Query	
Optional

For Onshape internal use.

CurveOnFaceDefinition type

Describes a set of isoparametric curves on a face.

Value	Type	Description
CurveOnFaceDefinition	map	
face
Query	
Face the curves are meant to lie on.

creationType
FaceCurveCreationType	
Determines the type of curves. Currently supports isoparameter curves only in primary or secondary directions, either equally spaced or defined by a parameter array.

names
array	
An array of distinct non-empty strings to identify the curves created.

nCurves
number	
Required if creationType is DIR1_AUTO_SPACED_ISO or DIR2_AUTO_SPACED_ISO

Number of curves.

parameters
array	
Required if creationType is DIR1_ISO or DIR2_ISO

Parameters to create curves at.

canBeCurveOnFaceDefinition (value) predicate

Typecheck for CurveOnFaceDefinition

curveOnFaceDefinition (face is Query, creationType is FaceCurveCreationType, names is array, nCurves is number) returns CurveOnFaceDefinition

Returns a new CurveOnFaceDefinition.

curveOnFaceDefinition (face is Query, creationType is FaceCurveCreationType, names is array, parameters is array) returns CurveOnFaceDefinition

opCreateCurvesOnFace (context is Context, id is Id, definition is map)

Generates isoparametric curves of faces. That is, for each specified surface parameter value, creates a new wire body following the curve which keeps the surface parameter at that constant value.

Parameter	Type	Additional Info
definition	map	
curveDefinition
array	
An array of CurveOnFaceDefinitions that describe group of curves per face.

showCurves
boolean	
Optional

Whether to display isoparameteric curves in color in the preview.

skipTrim
boolean	
Optional

Whether to skip trimming of curves by the face boundaries. Lines and arcs are always trimmed.

useFaceParameter
boolean	
Optional

For Onshape internal use.

opDeleteBodies (context is Context, id is Id, definition is map)

Deletes bodies from the context.

Parameter	Type	Additional Info
definition	map	
entities
Query	
Entities to delete. Passing in entities other than bodies deletes their owning bodies.

opDeleteFace (context is Context, id is Id, definition is map)

This is a direct editing operation that attempts to delete faces of a solid body and extend other faces to fill the hole.

Parameter	Type	Additional Info
definition	map	
deleteFaces
Query	
Faces to delete.

includeFillet
boolean	
true to also delete fillets adjacent to the input faces.

capVoid
boolean	
If capVoid is true and the deleted face cannot be filled by extending the surrounding faces, will attempt to replace the face with a planar face.

leaveOpen
boolean	
Optional

If leaveOpen is true the void from deleting faces is left open, potentially creating a surface out of a solid body. Default is false.

opEnclose (context is Context, id is Id, definition is map)

Takes in a set of bodies and faces and creates solid bodies for the enclosed regions.

Parameter	Type	Additional Info
definition	map	
entities
Query	
Bodies and faces for enclosure.

opDraft (context is Context, id is Id, definition is map)

Applies a given draft angle to faces.

Parameter	Type	Additional Info
definition	map	
draftType
DraftType	
Specifies a reference surface (e.g. a neutral plane) or reference entity draft.

EXAMPLE

DraftType.REFERENCE_SURFACE for a reference surface draft
draftFaces
Query	
Required if draftType is REFERENCE_SURFACE

The faces to draft for a REFERENCE_SURFACE draft.

referenceSurface
Required if draftType is REFERENCE_SURFACE

A face or plane that defines the neutral surface for a REFERENCE_SURFACE draft. draftFaces will remain unchanged where they intersect referenceSurface. Can be either a Query or a Plane.

referenceEntityDraftOptions
array	
Required if draftType is REFERENCE_ENTITY

An array of maps of the form ("face", "references", "angle"). "face" should be a Query for exactly one face. "references" should be a Query for at least one edge attached to the face. The "face" will be drafted while the geometry of the "references" remains unchanged. "angle" is an optional ValueWithUnits parameter between -89.9 and 89.9 degrees which overrides the default angle parameter.

pullVec
Vector	
The 3d direction relative to which the draft is applied.

EXAMPLE

vector(0, 0, 1) .
angle
ValueWithUnits	
The draft angle, must be between 0 and 89.9 degrees.

EXAMPLE

3 * degree
tangentPropagation
boolean	
Optional

For a REFERENCE_SURFACE draft, true to propagate draft across tangent faces. Default is false.

referenceEntityPropagation
boolean	
Optional

For a REFERENCE_ENTITY draft, true to collect new reference entities and faces by pulling in edges connected to the specified reference edges. Connected edges on the same face or on tangent connected faces will be pulled in. Default is false.

reFillet
boolean	
Optional

true to attempt to defillet draft faces before the draft and reapply the fillets after. Default is false.

opExtractWires (context is Context, id is Id, definition is map)

Generates wire bodies from the supplied edges. If the edges are disjoint multiple wires will be returned. If the edges overlap or cross, or more than two meet at a point, the function will fail.

Parameter	Type	Additional Info
definition	map	
edges
Query	
The edges to be extracted.

opExtrude (context is Context, id is Id, definition is map)

Extrudes one or more edges or faces in a given direction with one or two end conditions. Faces get extruded into solid bodies and edges get extruded into sheet bodies.

Parameter	Type	Additional Info
definition	map	
entities
Query	
Edges and faces to extrude.

direction
Vector	
The 3d direction in which to extrude.

EXAMPLE

evOwnerSketchPlane(context, {"entity" : entities}).normal to extrude perpendicular to the owner sketch
EXAMPLE

evPlane(context, {"face" : entities}).normal to extrude perpendicular to the first planar entity
endBound
BoundingType	
The type of bound at the end of the extrusion. Cannot be SYMMETRIC or UP_TO_VERTEX.

EXAMPLE

BoundingType.BLIND
endDepth
ValueWithUnits	
Required if endBound is BLIND.

How far from the entities to extrude.

EXAMPLE

1 * inch
endBoundEntity
Query	
Required if endBound is UP_TO_SURFACE or UP_TO_BODY.

The face or body that provides the bound.

endTranslationalOffset
ValueWithUnits	
Optional

The translational offset between the extrude end cap and the end bound entity. The direction vector for this is the same as direction: negative values pull the end cap away from the bound entity when endDepth is positive. endOffset will only have an effect if endBound is UP_TO_SURFACE, UP_TO_BODY, or UP_TO_NEXT.

startBound
BoundingType	
Optional

The type of start bound. Default is for the extrude to start at entities. Cannot be SYMMETRIC or UP_TO_VERTEX.

isStartBoundOpposite
Required if is UP_TO_SURFACE, UP_TO_BODY, or UP_TO_NEXT.

Whether the startBound extends in the opposite direction from the profile as the endBound. Defaults to true if not supplied.

startDepth
ValueWithUnits	
Required if startBound is BLIND.

How far from the entities to start the extrude. The direction vector for this is the negative of direction: positive values make the extrusion longer when endDepth is positive.

startBoundEntity
Query	
Required if startBound is UP_TO_SURFACE or UP_TO_BODY.

The face or body that provides the bound.

startTranslationalOffset
ValueWithUnits	
Optional

The translational offset between the extrude start cap and the start bound entity. The direction vector for this is the negative of direction: negative values pull the end cap away from the bound entity when startDepth is positive. startOffset will only have an effect if startBound is UP_TO_SURFACE, UP_TO_BODY, or UP_TO_NEXT.

opFaceBlend (context is Context, id is Id, definition is map)

Performs a face blend between two walls of faces.

Parameter	Type	Additional Info
definition	map	
side1
Query	
First set of faces, must belong to the same body.

side2
Query	
Second set of faces, must belong to the same body.

flipSide1Normal
boolean	
Wether to flip side 1's normal.

flipSide2Normal
boolean	
Wether to flip side 2's normal.

propagation
boolean	
Optional

Whether to propagate the blend.

propagationType
FaceBlendPropagation	
Optional

How to propagate the blend. FaceBlendPropagation.TANGENT will propagate over tangent faces. FaceBlendPropagation.ADJACENT will propagate over all adjacent faces. FaceBlendPropagation.CUSTOM allows specification of a maximum angle between faces for propagation. Defaults is FaceBlendPropagation.TANGENT.

propagationAngle
ValueWithUnits	
Optional

Maximum angle between faces for propagation. Used if propagationType is FaceBlendPropagation.CUSTOM. Default is 0 * radian.

crossSection
FaceBlendCrossSection	
The cross section type of the blend.

spine
Query	
Required if crossSection is DISC.

The spine of the blend. The blend's cross section will be orthogonal to the spine.

blendControlType
BlendControlType	
Whether the blend is controled by a constant radius or a constant width.

crossSectionShape
FaceBlendCrossSectionShape	
What shape the cross section of the blend will be.

radius
ValueWithUnits	
Required if blendControlType is RADIUS.

The radius of the cross section.

width
ValueWithUnits	
Required if blendControlType is WIDTH.

The width of the blend.

asymmetric
boolean	
Optional

Wether the radius or width is the same on each wall.

secondRadius
ValueWithUnits	
Required if blendControlType is RADIUS and asymmetric is true.

The radius of the cross section from side 2.

widthRatio
number	
Required if blendControlType is WIDTH and asymmetric is true.

How the blend will be divided between the walls. If widthRatio < 1, it will be wider towards side 1. If widthRatio > 1, it will be wider towards side 2.

rho
number	
Required if crossSectionShape is CONIC

Parameter of the conic cross section shape.

magnitude
number	
Required if crossSectionShape is CURVATURE

Parameter of the curvature cross section shape.

tangentHoldLines
boolean	
Optional

Whether to use the content of tangentEdges and inverseTangentEdges.

tangentEdges
Query	
Optional

Edges to use as tangent hold lines.

inverseTangentEdges
Query	
Optional

Edges to use as inverse tangent hold lines.

conicHoldLines
boolean	
Optional

Whether to use the content of conicEdges and inverseConicEdges.

conicEdges
Query	
Optional

Edges to use as conic hold lines.

inverseConicEdges
Query	
Optional

Edges to use as inverse conic hold lines.

hasCliffEdges
boolean	
Optional

Whether to use the content of cliffEdges.

cliffEdges
Query	
Optional

Edges to use as cliff edges.

hasCaps
boolean	
Optional

Whether to use the content of caps.

caps
array	
Optional

Entities and flip flags to use as caps. Each map should contain an entity Query element and a flip boolean element.

hasLimits
boolean	
Optional

Whether to use the content of limitPlane1, limitPlane2, faceLimits and edgeLimit.

limitPlane1
Query	
Optional

First plane to limit the blend.

limitPlane1Flip
boolean	
Whether to flip the first plane normal. Defines which side of the plane the blend will be.

limitPlane2
Query	
Optional

Second plane to limit the blend.

limitPlane2Flip
boolean	
Whether to flip the first plane normal. Defines which side of the plane the blend will be.

faceLimits
Query	
Optional

Faces to use as limits to the blend.

edgeLimit
array	
Optional

Edges and adjacent faces to use as limits. Each map should contain an edge Query element and an edgeLimitSide query element.

hasHelpPoint
boolean	
Optional

Whether to use the content of helpPoint.

helpPoint
Query	
Optional

Vertex or mate connector to use as help point. In case the blend parameters create several blends, only the blend closest to the help point will be kept.

trim
FaceBlendTrimType	
Optional

How to trim the blend.

detach
boolean	
Optional

Whether not to attach the blend(s) to the sides, creating new sheet bodies.

showIsocurves
boolean	
Optional

Show graphical representation of a subset of isoparameteric curves of the created surface. Default false.

curveCount
number	
Optional

When showIsocurves is true, the number of curves to draw in each direction of the grid. Default 10.

opFillet (context is Context, id is Id, definition is map)

For edges, performs a fillet on the edge. For faces, performs a fillet on all edges adjacent to the face.

Parameter	Type	Additional Info
definition	map	
entities
Query	
Edges and faces to fillet.

radius
ValueWithUnits	
The fillet radius.

EXAMPLE

1 * inch
tangentPropagation
boolean	
Optional

true to propagate the fillet along edges tangent to those passed in. Default is false.

crossSection
FilletCrossSection	
Optional

Fillet cross section. One of CIRCULAR, CONIC, CURVATURE. Default is CIRCULAR.

rho
number	
Required if crossSection is CONIC.

A number between 0 and 1, specifying the Rho value of a conic fillet

EXAMPLE

0.01 creates a flat, nearly-chamfered shape.
EXAMPLE

0.99 creates a pointed, nearly-unchanged shape.
magnitude
number	
Required if crossSection is CURVATURE.

A number between 0 and 1, specifying the magnitude of curvature match.

partialFilletBounds
array	
Optional

An array of maps representing the boundaries of a partial fillet. Each map should contain a boundaryEdge query, a boundaryParameter value, a isFlipped boolean

EXAMPLE

[{ "boundaryEdge" : edgeQuery0, "boundaryParameter" : 0.3, "isFlipped" : false }, { "boundaryEdge" : edgeQuery1, "boundaryParameter" : 0.6, "isFlipped" : true }]
isVariable
boolean	
Optional

Fillet controls can be varied at vertices via vertexSettings. Default is false.

vertexSettings
array	
Optional

An array of maps representing fillet settings at specified vertices. Each map should contain a vertex query, a vertexRadius value, a variableMagnitude if the crossSection is FilletCrossSection.CURVATURE, and a variableRho if the crossSection is FilletCrossSection.CONIC.

EXAMPLE

[{ "vertex" : vertexQuery0, "vertexRadius" : 1 * inch, "variableRho" : 0.2 }, { "vertex" : vertexQuery1, "vertexRadius" : 2 * inch, "variableRho" : 0.8 }]
pointOnEdgeSettings
array	
Optional

An array of maps representing fillet settings at specified points on edges. Each map should contain an edge query, an edgeParameter value, a pointOnEdgeRadius value, a pointOnEdgeVariablMagnitude if the crossSection is FilletCrossSection.CURVATURE, and a pointOnEdgeVariableRho if the crossSection is FilletCrossSection.CONIC.

EXAMPLE

[{ "edge" : edgeQuery0, "edgeParameter" : 0.3, "pointOnEdgeRadius" : 1 * inch }, { "edge" : edgeQuery1, "edgeParameter" : 0.6, "pointOnEdgeRadius" : 2 * inch }]
smoothTransition
boolean	
Required if isVariable is true

Whether to create a smoother transition between each vertex.

allowEdgeOverflow
boolean	
Optional

Allow opFillet to modify nearby edges to maintain the fillet profile. Default is true.

keepEdges
Query	
Optional

Edges you do not want opFillet to modify if allowEdgeOverflow is true.

smoothCorners
boolean	
Optional

Allow opFillet to smooth all suitable corners and prevent creation of sharp edges. Default is false.

smoothCornerExceptions
Query	
Optional

Vertices you do not want opFillet to smooth if smoothCorners is true.

createDetachedSurface
boolean	
Optional

Operation does not modify the body of the selected edges, but results in surface geometry of fillet. Default is false.

opFillSurface (context is Context, id is Id, definition is map)

Generates a surface body from supplied boundary and internal constraints. The boundaries are defined as edge queries for each continuity constraint. The internal constraints may be defined as a set of support vertices.

Parameter	Type	Additional Info
definition	map	
edgesG0
Query	
The edges with position constraints.

edgesG1
Query	
The edges with tangency constraints.

edgesG2
Query	
The edges with curvature constraints.

guideVertices
Query	
The vertices the resulting surface is expected to interpolate.

showIsocurves
boolean	
Optional

Show graphical representation of a subset of isoparameteric curves of the created surface. Default false.

curveCount
number	
Optional

When showIsocurves is true, the number of curves to draw in each direction of the grid. Default 10.

opFitSpline (context is Context, id is Id, definition is map)

Creates a 3D cubic spline curve through an array of 3D points.

Parameter	Type	Additional Info
definition	map	
points
array	
An array of Vectors with length units for the spline to interpolate. If the first point is the same as the last point, the spline is closed.

EXAMPLE

[
    vector( 1,  1,  1) * inch,
    vector(-1,  1, -1) * inch,
    vector( 1, -1, -1) * inch,
    vector(-1, -1,  1) * inch,
    vector( 1,  1,  1) * inch
]
parameters
array	
Optional

An array of doubles, parameters corresponding to the points.

startDerivative
Vector	
Optional

A Vector with length units that specifies the derivative at the start of the resulting spline (according to the arcLengthParameterization set to false).

endDerivative
Vector	
Optional

A Vector with length units that specifies the derivative at the end of the resulting spline. Ignored if spline is closed.

start2ndDerivative
Vector	
Optional

A Vector with length units that specifies the second derivative at the start of the resulting spline. Ignored if spline is closed, or if startDerivative is not defined

end2ndDerivative
Vector	
Optional

A Vector with length units that specifies the second derivative at the end of the resulting spline. Ignored if spline is closed, or if endDerivative is not defined

derivatives
map	
Optional

A map of derivatives at non-end points. Entries should be index : derivative, where index is an integer between 1 and size(points) - 2 and derivative is a Vector that specifies the derivative at points[index].

opFlipOrientation (context is Context, id is Id, definition is map)

Reverses the orientation of sheet bodies.

Parameter	Type	Additional Info
definition	map	
bodies
Query	
Sheet bodies whose orientation should be flipped.

opFullRoundFillet (context is Context, id is Id, definition is map)

Creates a full round fillet, replacing the center face(s) with circular profile face(s) of varying radius, joining the selected side faces.

Parameter	Type	Additional Info
definition	map	
side1Face
Query	
A face on one side of the blend.

side2Face
Query	
A face on another side of the blend.

centerFaces
Query	
The face(s) to be replaced.

tangentPropagation
boolean	
Optional

true to propagate the fillet across side face tangencies. Default is true.

opHelix (context is Context, id is Id, definition is map)

Creates a helical and possibly spiral curve.

Parameter	Type	Additional Info
definition	map	
direction
Vector	
The direction of the helix axis.

EXAMPLE

vector(0, 0, 1)
axisStart
Vector	
A point on the helix axis.

EXAMPLE

vector(0, 0, 0) * inch
startPoint
Vector	
The start point of the infinite helix. Must be off the axis. This is the point at which the created curve would actually start if the first number of interval is 0.

EXAMPLE

vector(1, 0, 0) * inch
interval
Vector	
An array of two numbers denoting the interval of the helix in terms of revolution counts.

EXAMPLE

[0, 10] will create a curve with 10 revolutions.
clockwise
boolean	
EXAMPLE

true if this is a clockwise helix when viewed along direction.
helicalPitch
ValueWithUnits	
Distance along the axis between successive revolutions.

EXAMPLE

0.1 * inch will create a helix with 10 revolutions per inch.
EXAMPLE

0 * inch produces a planar Archimedean spiral.
spiralPitch
ValueWithUnits	
Change in radius between successive revolutions.

EXAMPLE

0 * inch produces a helix that lies on a cylinder.
opHole (context is Context, id is Id, definition is map) returns array

Creates hole tools referencing a set of targets, optionally subtracting the tools from the targets. If some tools cannot be built, the operation will still succeed and indicate in its return value which holes failed to build. If no tools can be built, the operation will fail.

Parameter	Type	Additional Info
definition	map	
holeDefinition
HoleDefinition	
The definition of the shape of the desired holes.

EXAMPLE

holeDefinition([holeProfile(HolePositionReference.AXIS_POINT, 0 * inch, 0.1 * inch), holeProfile(HolePositionReference.AXIS_POINT, 1 * inch, 0 * inch)])
axes
array	
An array of Lines each of whose origin represents the start position of a hole, and whose direction represents the drill direction of the hole.

EXAMPLE

[line(vector(-1, -1, 0) * inch, vector(0, 0, -1)), line(vector(1, 1, 0) * inch, vector(0, 0, -1))]
identities
array	
Optional

An array of queries, one per axis in axes, used to disambiguate each of the created holes. Each query should resolve to exactly one entity. Providing this information does not change the geometric outcome, but stabilizes references to the holes with respect to upstream changes to the model.

targets
Query	
Required if holeDefinition contains any profiles that do not reference HolePositionReference.AXIS_POINT, or if subtractFromTargets is true

A set of bodies to target. The shape of the produced holes is dependent on the shape of these targets (as specified in the supplied HoleDefinition), so the full set of targeted bodies should always be supplied, even if subtractFromTargets is false.

subtractFromTargets
boolean	
Optional

true if the hole geometry should be subtracted from the targets. false if the targets should not be modified, and the hole tools should be outputted as new solid bodies. Default is true. To subtract from a subset of targets, set this to true and supply a set of excluded targets as targetsToExcludeFromSubtraction. Removing the set of excluded targets from targets instead of using targetsToExcludeFromSubtraction is not the correct way to call this interface, and may result in the shape of the hole changing.

targetsToExcludeFromSubtraction
Query	
Optional

If supplied and subtractFromTargets is true, the given targets are excluded from the subtraction. Ignored if subtractFromTargets is false

keepTools
boolean	
Optional

If subtractFromTargets is true, controls whether the hole tools should be outputted as new solid bodies. Default is false. Ignored if subtractFromTargets is false; in that case hole tools are always outputted as new solid bodies.

Return type	Description
array	
An array representing target intersection information for each hole. The array is aligned with the axes input. Each item in the array is a map containing a boolean field success, which indicates whether the tool was successfully built. If success is true the map will contain three additional entries: targetToDepthExtremes, positionReferenceInfo and holeDepth.

The value of targetToDepthExtremes is a map mapping the targets that the given hole intersects to a map of intersection information for those targets. Only targets that are intersected by the hole will be present in the map. Each map key is a Query for one of the targets, and the corresponding value is itself a map of the form { "firstEntrance" : firstEntranceDistance, "fullEntrance" : fullEntranceDistance, "firstExit" : firstExitDistance, "fullExit" : fullExitDistance }

firstEntranceDistance, fullEntranceDistance, firstExitDistance, and fullExitDistance are ValueWithUnits representing distances, along the axis, from the origin point of the axis to various important markers on the infinite hole cylinder. firstEntranceDistance and fullEntranceDistance represent the range over which the infinite hole cylinder enters the part, with firstEntranceDistance representing where the infinite hole cylinder first enters the part, and fullEntranceDistance representing where the infinite hole cylinder fully enters the part. These values are distinct when the entrance face into the part is slanted (or otherwise irregular). firstExitDistance and fullExitDistance similarly represent the range over which the infinite hole cylinder exits the part.

The value of positionReferenceInfo is a map whose keys are the HolePositionReferences found in the holeDefinition and whose value is a map of the form { "referenceRootStart" : referenceRootStartDistance, "referenceRootEnd" : referenceRootEndDistance, "target" : targetQuery }.

referenceRootStartDistance is a ValueWithUnits representing the distance, along the axis, from the origin point of the axis to the first coincidence between the infinite hole cylinder and the reference in question. referenceRootEndDistance is a similar measurement to the last coincidence between the infinite hole cylinder and the reference in question. For flat references, such as a TARGET_START referencing the top face of a cube, these two values will be the same. The values will differ for slanted (or otherwise irregular) references where the infinite hole cylinder interacts with the reference over a range, rather than at a single distance.

targetQuery is a Query for the target that defines that position reference.

holeDepth is a ValueWithUnits representing the distance, along the axis from the first entrance of the intersected targets to the termination entity. Used for references such as UP_TO_ENTITY and UP_TO_NEXT to get a calculated depth of a hole.

EXAMPLE

// For an opHole operation creating two holes, both going into two stacked
// parts, the first of which being 1 inch thick with a slightly slanted top
// and flat bottom and the second being 3 inches thick with a flat top and
// bottom, and the holeDefinition referencing both TARGET_START and
// LAST_TARGET_START the return value may look like:
[
    { // First hole (successful)
        "success" : true,
        "targetToDepthExtremes" : {
                    (firstTargetQuery)  : {
                            "firstEntrance" : 0.1 * inch,
                            "fullEntrance" : 0.3 * inch,
                            "firstExit" : 1 * inch,
                            "fullExit" : 1 * inch
                        },
                    (secondTargetQuery) : {
                            "firstEntrance" : 1 * inch,
                            "fullEntrance" : 1 * inch,
                            "firstExit" : 4 * inch,
                            "fullExit" : 4 * inch
                        }
                },
        "positionReferenceInfo" : {
                    HolePositionReference.TARGET_START : {
                            "referenceRootStart" : 0.1 * inch,
                            "referenceRootEnd" : 0.3 * inch,
                            "target" : firstTargetQuery
                        },
                    HolePositionReference.LAST_TARGET_START : {
                            "referenceRootStart" : 1 * inch,
                            "referenceRootEnd" : 1 * inch,
                            "target" : secondTargetQuery
                        },
                }
    },
    { // Second hole (successful)
        "success" : true,
        "targetToDepthExtremes" : {
                    (firstTargetQuery)  : {
                            "firstEntrance" : 0.4 * inch,
                            "fullEntrance" : 0.6 * inch,
                            "firstExit" : 1 * inch,
                            "fullExit" : 1 * inch
                        },
                    (secondTargetQuery) : {
                            "firstEntrance" : 1 * inch,
                            "fullEntrance" : 1 * inch,
                            "firstExit" : 4 * inch,
                            "fullExit" : 4 * inch
                        }
                },
        "positionReferenceInfo" : {
                    HolePositionReference.TARGET_START : {
                            "referenceRootStart" : 0.4 * inch,
                            "referenceRootEnd" : 0.6 * inch,
                            "target" : firstTargetQuery
                        },
                    HolePositionReference.LAST_TARGET_START : {
                            "referenceRootStart" : 1 * inch,
                            "referenceRootEnd" : 1 * inch,
                            "target" : secondTargetQuery
                        },
                }
    },
    { // Third hole (unsuccessful)
        "success" : false
    }
]
opImportForeign (context is Context, id is Id, definition is map)

Brings foreign geometry into the context. This function is used for importing uploaded parts.

Parameter	Type	Additional Info
definition	map	
blobData
CADImportData	
Reference to a blob element hosting uploaded CAD data.

flatten
boolean	
Optional

Whether to flatten assemblies; defaults to false.

yAxisIsUp
boolean	
Optional

If true, the y axis in the import maps to the z axis and z maps to -y. If false (default), the coordinates are unchanged.

isModifiable
boolean	
Optional

Whether the imported data is modifiable (default) or not.

opCreateIsocline (context is Context, id is Id, definition is map)

Creates wires corresponding to the given faces's isocline edges. Each isocline follows a path along a face with a constant angle in the (-90, 90) degree range (e.g., lines of latitude on a sphere). This angle is the face tangent plane's angle with respect to the direction with its sign determined by the dot product of direction and the face normal, and is analogous to the angle used in draft analysis. Depending on the face geometry, there may be zero, one, or multiple isoclines on each face.

Parameter	Type	Additional Info
definition	map	
faces
Query	
The faces on which to imprint isoclines.

direction
Vector	
A reference direction.

angle
ValueWithUnits	
The isocline angle with respect to the direction in the (-90, 90) degree range.

opLoft (context is Context, id is Id, definition is map)

Creates a surface or solid loft fitting an ordered set of profiles, optionally constrained by guide curves.

Parameter	Type	Additional Info
definition	map	
profileSubqueries
array	
An ordered array of queries for the profiles. For a solid loft, these must be sheet bodies, faces, or vertices. For a surface loft, these could be wire bodies, sheet bodies, faces, edges, or vertices.

EXAMPLE

[ profileQuery1, profileQuery2 ]
guideSubqueries
array	
Optional

An array of queries for guide curves. Each guide curve should intersect each profile once.

connections
array	
Optional

An array of maps to define multiple profile alignments. Each connection map should contain:

(1) connectionEntities query describing an array of vertices or edges (one per profile),

(2) connectionEdges an array of individual queries for edges in connectionEntities. The order of individual edge queries should be synchronized with connectionEdgeParameters.

(3) connectionEdgeParameters array - an ordered and synchronized array of parameters on edges in connectionEdgeQueries

EXAMPLE

[ {"connectionEntities" : qVertexAndEdge1, "connectionEdges" : [qEdge1], "connectionEdgeParameters" : [0.25]} {"connectionEntities" : qVertexAndEdge2, "connectionEdges" : [qEdge2], "connectionEdgeParameters" : [0.75]}]
connectionsArcLengthParameterization
boolean	
Optional

Defaults to false for better performance. Controls interpretation of connectionEdgeParameters. If evDistance, evEdgeTangentLine etc. are called in conjunction with opLoft the same value should be passed as arcLengthParameterization there.

makePeriodic
boolean	
Optional

Defaults to false. A closed guide creates a periodic loft regardless of this option.

bodyType
ToolBodyType	
Optional

Specifies a SOLID or SURFACE loft. Default is SOLID.

trimGuidesByProfiles
boolean	
Optional

If false (default) use full length of guides. If true restrict resulting surface by the first and last profile. Meaningful only for non-periodic surface loft.

trimProfiles
boolean	
Optional

If false (default) use full length of profiles. If true restrict resulting surface by the first and last guide or connection. Meaningful only for surface loft with open profiles.

derivativeInfo
array	
Optional

An array of maps that contain shape constraints at start and end profiles. Each map entry is required to have a profileIndex that refers to the affected profile. Optional fields include a vector to match surface tangent to, a magnitude, and booleans for matching tangents or curvature derived from faces adjacent to affected profile.

EXAMPLE

[ { "profileIndex" : 0, "vector" : vector(1, 0, 0), "magnitude" : 2., "tangentToPlane" : true}, { "profileIndex" : 1, "matchCurvature" : true, "adjacentFaces" : qFaces } ] The first map would constrain the resulting loft at the start profile to be tangent to plane with normal vector(1,0,0) and magnitude 2. The second map constrains the loft at the end profile to match the curvature of faces defined by the query qFaces.
showIsocurves
boolean	
Optional

Show graphical representation of a subset of isoparameteric curves on each face of the created loft. Default false.

curveCount
number	
Optional

When showIsocurves is true, the number of curves to draw in each direction of each face's grid. Default 10.

loftTopology
LoftTopology	
Optional

Specifies topology of lofted body. Default is MINIMAL.

addSections
boolean	
Optional

true to add a path. Default is false.

spine
Query	
Optional

Query to specify the edge for the path.

sectionCount
number	
Optional

Number of sections to add. Required if addSections=true.

opMateConnector (context is Context, id is Id, definition is map)

Creates a mate connector, which represents a coordinate system in the context. Currently it is a special type of point body.

Parameter	Type	Additional Info
definition	map	
coordSystem
CoordSystem	
The mate connector coordinate system.

owner
Query	
The owner body of the mate connector: when the owner is brought into an assembly, owned mate connectors will be brought in and move rigidly with it. If the query resolves to multiple bodies, the first is taken as the owner.

opMergeContexts (context is Context, id is Id, definition is map) returns array

Bring all of the information from contextFrom into context. This is used, for example, for the Derived feature.

Parameter	Type	Additional Info
context	Context	
The target context.

definition	map	
contextFrom
Context	
The source context. It is rendered unusable by this operation.

EXAMPLE

MyPartStudio::build()
trackThroughMerge
array	
Optional

Array of queries to map evaluation result in contextFrom to context post-merge

Return type	Description
array	
Returns array of the same size as trackThroughMerge with evaluation results for each query(array of arrays of transient queries).

opModifyFillet (context is Context, id is Id, definition is map)

This is a direct editing operation that modifies or deletes fillets.

Parameter	Type	Additional Info
definition	map	
faces
Query	
The fillets to modify.

modifyFilletType
ModifyFilletType	
Whether to change the fillet radii or remove them altogether.

radius
ValueWithUnits	
Required if modifyFilletType is CHANGE_RADIUS.

The new radius.

reFillet
boolean	
Required if modifyFilletType is CHANGE_RADIUS.

true to reapply adjacent fillets. Default is false.

opMoveFace (context is Context, id is Id, definition is map)

This is a direct editing operation that applies a transform to one or more faces.

Parameter	Type	Additional Info
definition	map	
moveFaces
Query	
The faces to transform.

transform
Transform	
The transform to apply to the face.

EXAMPLE

transform(vector(0, 0, 1) * inch) will translate the face 1 inch along the world's z-axis.
reFillet
boolean	
Optional

true to attempt to defillet moveFaces prior to the move and reapply the fillet after. Default is false.

mergeFaces
boolean	
Optional

true to remove redundant edges from moveFaces. Default is true.

opOffsetFace (context is Context, id is Id, definition is map)

This is a direct editing operation that offsets one or more faces.

Parameter	Type	Additional Info
definition	map	
moveFaces
Query	
The faces to offset.

offsetDistance
ValueWithUnits	
The positive or negative distance by which to offset.

EXAMPLE

0.1 * inch will offset the face 0.1 inches, normal to the face.
reFillet
boolean	
Optional

true to attempt to defillet moveFaces prior to the offset and reapply the fillet after. Default is false.

mergeFaces
boolean	
Optional

true to remove redundant edges from moveFaces. Default is true.

opPattern (context is Context, id is Id, definition is map)

Patterns input faces and/or bodies by applying transforms to them. The original faces and bodies are preserved.

Parameter	Type	Additional Info
definition	map	
entities
Query	
Bodies and faces to pattern.

transforms
array	
An array of Transforms to apply to entities. The transforms do not have to be rigid.

instanceNames
array	
An array of distinct non-empty strings the same size as transforms to identify the patterned entities. Similar to an Id, an instance names may consist only of letters, numbers, and any of +, -, /, _.

copyPropertiesAndAttributes
boolean	
Optional

If true (default), copies properties and attributes to patterned entities.

opPlane (context is Context, id is Id, definition is map)

Creates a construction plane.

Parameter	Type	Additional Info
definition	map	
plane
Plane	
The plane to create.

EXAMPLE

plane(vector(0, 0, 6) * inch, vector(0, 0, 1))
width
ValueWithUnits	
Optional

The side length of the construction plane, as it is initially displayed.

height
ValueWithUnits	
Optional

The side length of the construction plane, as it is initially displayed.

defaultType
DefaultPlaneType	
Optional

For Onshape internal use.

opPolyline (context is Context, id is Id, definition is map)

Creates a polyline passing through an array of 3D points.

Parameter	Type	Additional Info
definition	map	
points
array	
An array of Vectors with length units corresponding the points of the polyline. If the firstpoint is the same as the last point, the polyline is closed.

EXAMPLE

[
    vector( 1,  1,  1) * inch,
    vector(-1,  1, -1) * inch,
    vector( 1, -1, -1) * inch,
    vector(-1, -1,  1) * inch,
    vector( 1,  1,  1) * inch
]
bendRadii
array	
Optional

An array of ValueWithUnits, corresponding to the bend radii at each point. The value at index i corresponds to the bend at the point at index i + 1 in points. A value of 0 * meter means no bend at the corresponding point. Its size should be size(points) - 2 for an open polyline, size(points) - 1 for a closed one.

opDropCurve (context is Context, id is Id, definition is map)

Projects curves on a face.

Parameter	Type	Additional Info
definition	map	
tools
Query	
The edges to project.

targets
Query	
The faces/bodies the edges are to be projected onto.

projectionType
ProjectionType	
Projection method.

direction
Vector	
Optional

The direction in which to project the curve. Required if projectionType is ProjectionType.DIRECTION.

opIntersectFaces (context is Context, id is Id, definition is map)

Intersect two faces, creating curves appropriately.

Parameter	Type	Additional Info
definition	map	
tools
Query	
First array of faces to intersect.

targets
Query	
Second array of faces to intersect.

opSphere (context is Context, id is Id, definition is map)

Creates a sphere.

Parameter	Type	Additional Info
definition	map	
radius
ValueWithUnits	
The radius of the sphere.

EXAMPLE

1 * inch
center
Vector	
The location of the center of the sphere.

EXAMPLE

vector(1, 1, 1) * inch
opSplineThroughEdges (context is Context, id is Id, definition is map)

Creates a 3D spline curve representing a sequence of edges. The edges must form a tangent-continuous chain.

Parameter	Type	Additional Info
definition	map	
edges
Query	
Edges to approximate.

opSplitEdges (context is Context, id is Id, definition is map)

Splits an array of edges with an entity or at specified parameters.

Parameter	Type	Additional Info
definition	map	
edges
Query	
Edges to split.

parameters
array	
An array of array of parameters. Each edge gets split at the parameter values at the matching index in this array.

splittingSurface
Query	
A sheet body, a construction plane or a face to cut with. Can be either a Query or a Plane. Either splittingSurface or parameters must be specified but not both.

arcLengthParameterization
boolean	
Optional

If true (default), the parameter returned for edges measures distance along the edge, so 0.5 is the midpoint. If false, use an arbitrary but faster-to-calculate parameterization. Default is true.

opPoint (context is Context, id is Id, definition is map)

Creates a construction point (a BodyType.POINT with one vertex).

Parameter	Type	Additional Info
definition	map	
point
Vector	
The location of the point.

EXAMPLE

vector(0, 0, 1) * inch
origin
boolean	
Optional

For Onshape internal use.

opReplaceFace (context is Context, id is Id, definition is map)

This is a direct editing operation that replaces the geometry one or more faces with that of another face or multiple adjacent faces, possibly with an offset.

Parameter	Type	Additional Info
definition	map	
replaceFaces
Query	
The faces whose geometry to replace.

templateFace
Query	
The face or multiple adjacent faces whose geometry to use as the replacement.

offset
ValueWithUnits	
Optional

The positive or negative distance by which to offset the resulting face.

oppositeSense
boolean	
Optional

If true, flip the surface normal of the resulting face, which may be necessary to match the surface normals of surrounding faces. Default is false.

opRevolve (context is Context, id is Id, definition is map)

Revolves edges and faces about an axis to produce sheet and solid bodies. The edges and faces may abut, but not strictly intersect the axis.

Parameter	Type	Additional Info
definition	map	
entities
Query	
The edges and faces to revolve.

axis
Line	
The axis around which to revolve.

EXAMPLE

line(vector(0, 0, 0) * inch, vector(0, 0, 1))
angleForward
ValueWithUnits	
The angle where the revolve ends relative to entities. Normalized to the range \[0, 2 PI).

EXAMPLE

30 * degree
angleBack
ValueWithUnits	
Optional

The angle where the revolve starts relative to entities. Normalized to the range \[0, 2 PI). If angleForward == angleBack, the revolve is a full (360-degree) revolve. Defaults to 0.

opRuledSurface (context is Context, id is Id, definition is map) returns array

Creates a ruled surface along a set of paths. Direction of ruled surface is specified with either ruledDirection or angleFromFaces.

Parameter	Type	Additional Info
definition	map	
path
Query	
The edges that form the paths for the ruled surface.

cornerType
RuledSurfaceCornerType	
Optional

How corners in the ruled surface are handled. Default is RuledSurfaceCornerType.SPUN.

useCubicInterpolation
boolean	
Optional

Ruled surface will use a cubic interpolation if true. Otherwise, a linear interpolation will be used. Default is true.

width
ValueWithUnits	
The width of the ruled surface.

ruledSurfaceType
RuledSurfaceType	
Specifies how the ruled surface is constructed.

ruledDirection
Vector	
Required if ruledSurfaceType is ALIGNED_WITH_VECTOR

Ruled surface will be aligned with this vector.

angle
ValueWithUnits	
The angle at which the ruled surface meets reference faces or ruledDirection. Default is 0.

referenceFaces
Query	
Required if ruledSurfaceType is ANGLE_FROM_FACE

A set of faces from which to measure angleFromFaces.

vertexOverrides
map	
vertex
Query	
A vertex on the path where the override is applied.

ruledDirection
Vector	
If specified, override will specify local direction of ruled surface along this vector.

width
ValueWithUnits	
Required if ruledDirection != undefined or angleFromFaces != undefined

Width of ruled surface at this override.

angleFromFaces
ValueWithUnits	
If specified, override will specify direction as an angle to reference faces. This is only applicable if angleFromFaces is also specified at the top level.

upToEntity
Query	
If specified, override will specify that ruled surface touches upToEntity at override.

manipulatorPositions
map	
An array of positions for which local CoordSystems will be returned.

edge
Query	
One of the input edges.

parameter
number	
A parameter on the edge.

Return type	Description
array	
An array of local CoordSystems at the requested positions.

opShell (context is Context, id is Id, definition is map)

Create a shell of a solid body with uniform thickness. The bodies that are passed in are hollowed, omitting the walls on the face entities passed in.

Parameter	Type	Additional Info
definition	map	
entities
Query	
The faces to shell and solid bodies to hollow.

thickness
ValueWithUnits	
The distance by which to shell. Positive means shell outward, and negative means shell inward.

opSplitPart (context is Context, id is Id, definition is map)

Split solid, sheet, and wire bodies with the given sheet body.

Parameter	Type	Additional Info
definition	map	
targets
Query	
The solid, sheet, and wire bodies to split.

tool
A sheet body, a construction plane or a face to cut with. Can be either a Query or a Plane. If a planar face is passed in, the split will extend the plane infinitely unless useTrimmed is true.

keepTools
boolean	
Optional

If false, the tool is deleted. Default is false.

keepType
SplitOperationKeepType	
Optional

Controls which pieces to keep. Default is KEEP_ALL.

useTrimmed
boolean	
Optional

If true, the trimmed face boundaries are used as the tool, rather than the underlying surface. Default is false.

SplitFaceResult type

Map containing the results of opSplitFace.

Value	Type	Description
SplitFaceResult	map	
splittingEdges
array	
An array of edges where the faces intersect.

opSplitFace (context is Context, id is Id, definition is map)

Split faces with the given edges or faces. Returns an array of edges where the faces intersect. This includes already existing edges as well as edges that were created by opSplitFace.

Parameter	Type	Additional Info
definition	map	
faceTargets
Query	
The faces to split.

edgeTools
Query	
Optional

The edges to cut with.

projectionType
ProjectionType	
Optional

Edge projection method. Default is ProjectionType.NORMAL_TO_TARGET

direction
Vector	
Required if edgeTools are present and projectionType is ProjectionType.DIRECTION.

The projection direction.

faceTools
Query	
Optional

The faces to cut with.

bodyTools
Query	
Optional

The sheet or wire bodies to cut with.

keepToolSurfaces
boolean	
Optional

If true, the bodyTools do not get consumed by the operation. Default is true.

planeTools
Query	
Optional

These planar faces are treated as infinite, rather than bounded to the face extents.

extendToCompletion
boolean	
Optional

if true, imprinted edges are extended to complete split of faces. Default is false.

mutualImprint
boolean	
Optional

if true and only bodyTools are supplied target faces are used to split faces of bodyTools. Default is false.

SplitByIsoclineResult type

Map containing the results of splitting faces by their isoclines. Some faces may have been split, others may have been left intact.

Value	Type	Description
SplitByIsoclineResult	map	
steepFaces
array	
An array of steep faces.

nonSteepFaces
array	
An array of non-steep faces.

boundaryEdges
array	
An array of edges at the transition from non-steep faces to steep faces.

opSplitByIsocline (context is Context, id is Id, definition is map)

Split the given faces by isocline edges. Each isocline follows a path along a face with a constant angle in the (-90, 90) degree range (e.g., lines of latitude on a sphere). This angle is the face tangent plane's angle with respect to the direction with its sign determined by the dot product of direction and the face normal, and is analogous to the angle used in draft analysis. Depending on the face geometry, there may be zero, one, or multiple isoclines on each face. The isocline edges are created as new edges which split the provided faces. The resulting faces are either steep (i.e., the angle is less than the input angle) or non-steep. To instead leave the original faces intact, you can first extract the faces with opExtractSurface(), and create isoclines on the resulting surfaces. The isocline edges can be queried for with qCreatedBy. The split orientation is consistent such that the non-steep faces are always in "front" of the split, and can be reliably queried for with qSplitBy:

EXAMPLE

const isoclineEdges = qCreatedBy(id + "splitByIsocline1", EntityType.EDGE);
const steepFaces = qSplitBy(id + "splitByIsocline1", EntityType.FACE, true);
const nonSteepFaces = qSplitBy(id + "splitByIsocline1", EntityType.FACE, false);
Note that qSplitBy will return only those faces that were split, while the returned SplitByIsoclineResult will include the intact faces as well.

Parameter	Type	Additional Info
definition	map	
faces
Query	
The faces on which to imprint isoclines.

direction
Vector	
A reference direction.

angle
ValueWithUnits	
The isocline angle with respect to the direction in the (-90, 90) degree range.

SplitBySelfShadowResult type

Map containing the results of splitting bodies by their shadow curves. Some faces may have been split, others may have been left intact.

Value	Type	Description
SplitBySelfShadowResult	map	
visibleFaces
array	
An array of visible faces.

invisibleFaces
array	
An array of invisible faces.

opSplitBySelfShadow (context is Context, id is Id, definition is map)

Splits the faces of the given bodies into visible and invisible regions with respect to the given viewDirection, creating shadow curves as necessary. A shadow curve represents the transition of one face from visible to invisible. Depending on the geometry, there may be zero, one, or more shadow curves per face. The shadow curve edges are created as new edges which split the faces of the provided bodies. Each of the resulting faces is wholly visible or wholly invisible. Edge-on faces are considered invisible. The shadow curve edges can be queried for with qCreatedBy. The split orientation is consistent such that the visible faces are always in "front" of the split, and can be reliably queried for with qSplitBy:

EXAMPLE

const shadowEdges = qCreatedBy(id + "splitBySelfShadow1", EntityType.EDGE);
const invisibleFaces = qSplitBy(id + "splitBySelfShadow1", EntityType.FACE, true);
const visibleFaces = qSplitBy(id + "splitBySelfShadow1", EntityType.FACE, false);
Note that qSplitBy will return only those faces that were split, while the returned SplitBySelfShadowResult will include the intact faces as well.

Parameter	Type	Additional Info
definition	map	
bodies
Query	
The bodies which cast shadows and on which to imprint shadow curves.

viewDirection
Vector	
The viewing direction.

opSweep (context is Context, id is Id, definition is map)

Sweep the given edges and faces along a path resulting in solid and/or sheet bodies.

Parameter	Type	Additional Info
definition	map	
profiles
Query	
Edges and faces to sweep.

path
Query	
Edges that comprise the path along which to sweep. The edges can be in any order but must form a connected path.

keepProfileOrientation
boolean	
Optional

If true, the profile maintains its original orientation as it is swept. If false (default), the profile rotates to remain normal to the path.

lockFaces
Query	
Optional

Keep profile aligned to the normals of these faces.

lockDirection
Query	
Optional

Keep profile perpendicular to this direction.

profileControl
ProfileControlMode	
Optional

Default is NONE

EXAMPLE

ProfileControlMode.KEEP_ORIENTATION the profile maintains its original orientation as it is swept.
EXAMPLE

ProfileControlMode.LOCK_DIRECTION the profile is perpendicular to given direction.
EXAMPLE

ProfileControlMode.LOCK_FACES the profile is aligned to the normals of given faces.
opTessellatedLoft (context is Context, id is Id, definition is map)

Create a tessellated loft between two edge or vertex profiles.

Parameter	Type	Additional Info
definition	map	
profileSubqueries
array	
A two element array containing edge or vertex profiles to loft between.

chordalTolerance
ValueWithUnits	
The maximum distance a chord can deviate from the path. Default is 0.005 meters

connections
array	
Optional

An array of maps to define multiple profile alignments. Each connection map should contain:

(1) connectionEntities query describing an array of vertices or edges (one per profile),

(2) connectionEdges an array of individual queries for edges in connectionEntities. The order of individual edge queries should be synchronized with connectionEdgeParameters.

(3) connectionEdgeParameters array - an ordered and synchronized array of parameters on edges in connectionEdgeQueries

modelParameters
map	
Optional

frontThickness
ValueWithUnits	
The front thickness of the sheet metal.

backThickness
ValueWithUnits	
The back thickness of the sheet metal.

bendRadius
ValueWithUnits	
The bend radius of the sheet metal.

opThicken (context is Context, id is Id, definition is map)

Thicken sheet bodies and faces into solid bodies.

Parameter	Type	Additional Info
definition	map	
entities
Query	
The sheet bodies and faces to thicken.

thickness1
ValueWithUnits	
The distance by which to thicken in the direction along the normal.

thickness2
ValueWithUnits	
The distance by which to thicken in the opposite direction.

keepTools
boolean	
Optional

Default is true. If false the operation will attempt to delete the entities. The operation will not delete sheet bodies unless the sheet body or all faces of the sheet body are selected. The operation will not delete sketches or solid bodies.

opTransform (context is Context, id is Id, definition is map)

Applies a given transform to one or more bodies. To make transformed copies of bodies, use opPattern.

Parameter	Type	Additional Info
definition	map	
bodies
Query	
The bodies to transform.

transform
Transform	
The transform to apply.

EXAMPLE

transform(vector(0, 0, 1) * inch) will translate the body 1 inch along the world's z-axis.
EXAMPLE

rotationAround(myLine, 30 * degree) will rotate around a Line object.
EXAMPLE

scaleUniformly(factor) will scale uniformly about the origin.
EXAMPLE

scaleUniformly(factor, point) will scale uniformly about a given point.
EXAMPLE

toWorld(cSys) will (somewhat counterintuitively) perform a transform such that geometry on the world's origin and axes will move to the cSys origin and axes.
EXAMPLE

fromWorld(cSys) will (somewhat counterintuitively) perform a transform such that geometry on the cSys origin and axes will move to the world origin and axes.
EXAMPLE

transform2 * transform1 will perform transform1, followed by transform2.
opWrap (context is Context, id is Id, definition is map)

Wraps or unwraps faces from one surface onto another. The location and orientation of the wrapped faces on the destination surface are controlled by the anchorPoint and anchorDirection of the source and destination WrapSurfaces. The entities of the operation are not affected, the result of this operation is a new set of surface bodies or imprinted edges representing the wrapped or unwrapped faces. Faces that are topologically connected will remain topologically connected in the result body for WrapType.SIMPLE and WrapType.TRIM. This operation currently supports wrapping from a plane onto a cylinder or a cone, and unwrapping from a cylinder or a cone onto a plane.

(Formerly opRoll)

Parameter	Type	Additional Info
definition	map	
wrapType
WrapType	
The type of wrap to execute.

EXAMPLE

WrapType.SIMPLE wraps entities around the infinite definition of destination.
entities
Query	
Faces to wrap from source to destination.

source
WrapSurface	
The surface to wrap from. All entities must lie on this surface.

destination
WrapSurface	
The surface to wrap onto. Must be defined using the face field for WrapType.TRIM or WrapType.IMPRINT.

orientWithDestination
boolean	
Optional

If true (default), the normals of the resulting surface will point in the same direction as the destination. If false, the normals of the resulting surface will point in the opposite direction. For the purpose of this parameter, the normals of a WrapSurface defined by an infinite Cylinder are always pointing outwards.

primitives
cube (context is Context, id is Id, definition is map)

Create a cube of a specified size, with one corner on the origin.

Parameter	Type	Additional Info
definition	map	
sideLength
ValueWithUnits	
EXAMPLE

1 * inch
sphere (context is Context, id is Id, definition is map)

Feature creating a sphere. Internally, calls opSphere.

Parameter	Type	Additional Info
definition	map	
center
Query	
A vertex query marking the sphere's center.

radius
ValueWithUnits	
EXAMPLE

1 * inch
fCuboid (context is Context, id is Id, definition is map)

Create a simple rectangular prism between two specified corners.

Parameter	Type	Additional Info
definition	map	
corner1
Vector	
EXAMPLE

vector(0, 0, 0) * inch
corner2
Vector	
EXAMPLE

vector(1, 1, 1) * inch
fCylinder (context is Context, id is Id, definition is map)

Create a simple cylindrical solid between two points, with a specified radius.

Parameter	Type	Additional Info
definition	map	
topCenter
Vector	
A 3D length vector in world space.

EXAMPLE

vector(0, 0, 0) * inch
bottomCenter
Vector	
A 3D length vector in world space.

EXAMPLE

vector(1, 1, 1) * inch
radius
ValueWithUnits	
EXAMPLE

1 * inch
fCone (context is Context, id is Id, definition is map)

Create a solid cone, possibly truncated.

Parameter	Type	Additional Info
definition	map	
topCenter
Vector	
EXAMPLE

vector(1, 1, 1) * inch
bottomCenter
Vector	
EXAMPLE

vector(0, 0, 0) * inch
topRadius
ValueWithUnits	
The radius at the top center.

EXAMPLE

1 * inch
bottomRadius
ValueWithUnits	
The radius at the bottom center.

EXAMPLE

0 * inch produces a standard, non-truncated cone.
fEllipsoid (context is Context, id is Id, definition is map)

Create an ellipsoid (that is, a sphere scaled independently along the three major axes).

Parameter	Type	Additional Info
definition	map	
center
Vector	
EXAMPLE

vector(0, 0, 0) * inch
radius
Vector	
The three radii, as measured along the x, y, and z axes.

EXAMPLE

vector(0.5 * inch, 1 * inch, 2 * inch)
sketch
Functions used to create sketches, and add entities to sketches.

A sketch used in FeatureScript generally has the following form:

var sketch1 = newSketch(context, id + "sketch1", {
        "sketchPlane" : qCreatedBy(makeId("Top"), EntityType.FACE)
});
skRectangle(sketch1, "rectangle1", {
        "firstCorner" : vector(0, 0),
        "secondCorner" : vector(1, 1)
});
skSolve(sketch1);
extrude(context, id + "extrude1", {
        "entities" : qSketchRegion(id + "sketch1"),
        "endBound" : BoundingType.BLIND,
        "depth" : 0.5 * inch
});
A Sketch object should always be created first, with either newSketch or newSketchOnPlane.

Next, any number of sketch entities may be added to the sketch using the functions in this module. The inputs to sketch functions usually involve 2D Vectors, which are positions relative to the sketch plane's origin and x-axis. To create such a point based on a projected 3D point in world space, use worldToPlane(Plane, Vector).

When building sketches in FeatureScript, constraints may be added, but are almost always unnecessary, since you already have the ability to place the entities precisely where you intend them to be.

Finally, the sketch is solved and added to the context by calling skSolve. As a result of skSolve, all edges of the sketch will become WIRE bodies in the context. Any regions enclosed in the sketch will become SURFACE bodies in the context. Any vertices which are not edge endpoints (such as points created by skPoint or the center point of skCircle) will become POINT bodies in the context. These newly created bodies can be queried for and used in all subsequent operations and features.

Sketch type

A Sketch object represents a Onshape sketch, to which sketch entities can be added.

Sketches can be created by calls to newSketch or newSketchOnPlane.

canBeSketch (value) predicate

Typecheck for builtin Sketch

isIdForSketch (context is Context, id is Id)

Check whether an Id represents a Sketch operation.

newSketch (context is Context, id is Id, value is map) returns Sketch

Create a new sketch on an existing planar entity. The sketch coordinate system follows the canonical plane orientation and the sketch origin is the projection of the world origin onto the plane.

To make a sketch in the coordinate system of an arbitrary Plane, use newSketchOnPlane.

Parameter	Type	Additional Info
value	map	
sketchPlane
Query	
A Query for a single, planar entity.

EXAMPLE

qCreatedBy(makeId("Top"), EntityType.FACE) to sketch on default "Top" plane.
disableImprinting
boolean	
Optional

Prevents sketchPlane from imprinting on the sketch. Default is false.

newSketchOnPlane (context is Context, id is Id, value is map) returns Sketch

Create a new sketch on a custom plane, specified by a Plane object. The sketch coordinate system will match the coordinate system of the plane.

Parameter	Type	Additional Info
value	map	
sketchPlane
Plane	
EXAMPLE

plane(vector(0, 0, 0) * inch, vector(0, 0, 1)) to sketch on the world XY plane.
skSolve (sketch is Sketch)

Solve any constraints in the sketch and add all sketch entities form the sketch to its context.

Even if there are no constraints, a sketch must be solved before its entities are created.

skPoint (sketch is Sketch, pointId is string, value is map) returns map

Add a point to a sketch.

Parameter	Type	Additional Info
value	map	
position
Vector	
EXAMPLE

vector(0, 1) * inch
Return	Type	Description
map	
pointId
skLineSegment (sketch is Sketch, lineId is string, value is map) returns map

Add a line segment to a sketch.

Parameter	Type	Additional Info
value	map	
start
Vector	
EXAMPLE

vector(0, 0) * inch
end
Vector	
EXAMPLE

vector(1, 1) * inch
construction
boolean	
Optional

true for a construction line

Return	Type	Description
map	
startId
endId
skText (sketch is Sketch, textId is string, value is map) returns map

Add a text rectangle to a sketch.

Parameter	Type	Additional Info
value	map	
text
string	
A string of text to write. May contain newlines (encoded as \n).

fontName
string	
A font name, with extension ".ttf" or ".otf". To change font weight, replace "-Regular" with "-Bold", "-Italic", or "-BoldItalic".

Must be one of the following fonts:

EXAMPLE

"OpenSans-Regular.ttf" Sans-serif font. Default if no match is found.
EXAMPLE

"AllertaStencil-Regular.ttf" Stencil font. No bold/italic options.
EXAMPLE

"Arimo-Regular.ttf" Sans-serif font.
EXAMPLE

"DroidSansMono.ttf" Monospaced sans-serif font. No bold/italic options.
EXAMPLE

"NotoSans-Regular.ttf" Sans-serif font.
EXAMPLE

"NotoSansCJKjp-Regular.otf" Japanese font. No italic options.
EXAMPLE

"NotoSansCJKkr-Regular.otf" Korean font. No italic options.
EXAMPLE

"NotoSansCJKsc-Regular.otf" Chinese (simplified) font. No italic options.
EXAMPLE

"NotoSansCJKtc-Regular.otf" Chinese (traditional) font. No italic options.
EXAMPLE

"NotoSerif-Regular.ttf" Serif font.
EXAMPLE

"RobotoSlab-Regular.ttf" Sans-serif font. No italic options.
EXAMPLE

"Tinos-Regular.ttf" Serif font. Metrically compatible with Times New Roman.
construction
boolean	
Optional

true for a construction line

firstCorner
Vector	
Optional

One corner of the rectangle into which the text will be placed. Text will start at the left of the rectangle and extend to the right, overflowing the right if necessary. The first line of text will fill the height of the rectangle, with subsequent lines below the rectangle (or above if mirrored vertically).

EXAMPLE

vector(0, 0) * inch
secondCorner
Vector	
Optional

The other corner of the rectangle into which the text will be placed. Text will start at the left of the rectangle and extend to the right, overflowing the right if necessary. The first line of text will fill the height of the rectangle, with subsequent lines below the rectangle (or above if mirrored vertically).

EXAMPLE

vector(1, 1) * inch
mirrorHorizontal
boolean	
Optional

true for flipping text horizontally

mirrorVertical
boolean	
Optional

true for flipping text vertically

Return	Type	Description
map	
textId
skImage (sketch is Sketch, imageId is string, value is map) returns map

Add an image rectangle and return ids of corner points.

To use an image uploaded in your document, import the image (possibly into a namespace).

Parameter	Type	Additional Info
value	map	
blobInfo
map	
EXAMPLE

BLOB_DATA will use the image from an image file imported into this Feature Studio.
EXAMPLE

MyImage::BLOB_DATA will use an image imported into the namespace MyImage (e.g. using MyImage::import(...))
firstCorner
Vector	
One corner of the rectangle into which the image will be placed.

EXAMPLE

vector(0, 0) * inch
secondCorner
Vector	
The other corner of the rectangle into which the image will be placed.

EXAMPLE

vector(1, 1) * inch
Return	Type	Description
map	
imageId
skCircle (sketch is Sketch, circleId is string, value is map) returns map

Add a circle to a sketch.

Parameter	Type	Additional Info
value	map	
center
Vector	
EXAMPLE

vector(0, 0) * inch
radius
ValueWithUnits	
EXAMPLE

1 * inch
construction
boolean	
Optional

true for a construction line

Return	Type	Description
map	
centerId
skEllipse (sketch is Sketch, ellipseId is string, value is map) returns map

Add an ellipse to a sketch.

Parameter	Type	Additional Info
value	map	
center
Vector	
EXAMPLE

vector(0, 0) * inch
majorRadius
ValueWithUnits	
EXAMPLE

2 * inch
minorRadius
ValueWithUnits	
EXAMPLE

1 * inch
majorAxis
Vector	
Optional

A unitless 2D direction, specifying the orientation of the major axis

construction
boolean	
Optional

true for a construction line

Return	Type	Description
map	
centerId
skArc (sketch is Sketch, arcId is string, value is map) returns map

Add an arc through three points to a sketch.

Parameter	Type	Additional Info
value	map	
start
Vector	
EXAMPLE

vector(1, 0) * inch
mid
Vector	
EXAMPLE

vector(0, 1) * inch
end
Vector	
EXAMPLE

vector(-1, 0) * inch
construction
boolean	
Optional

true for a construction line

Return	Type	Description
map	
startId
endId
skEllipticalArc (sketch is Sketch, arcId is string, value is map) returns map

Add an elliptical arc to a sketch. The ellipse has a period of 1, a parameter of 0 at the major axis and 0.25 at the minor axis. The arc is drawn counterclockwise from the start point to the end point.

Parameter	Type	Additional Info
value	map	
center
Vector	
EXAMPLE

vector(0, 0) * inch
majorAxis
Vector	
The direction, in sketch coordinates, in which the major axis of the ellipse lies.

EXAMPLE

normalize(vector(1, 1))
minorRadius
ValueWithUnits	
A non-negative value with length units.

EXAMPLE

1 * inch
majorRadius
ValueWithUnits	
A non-negative value with length units. Does not need to be greater than the minor radius.

EXAMPLE

2 * inch
startParameter
number	
The parameter of the start point.

EXAMPLE

0
endParameter
number	
The parameter of the end point.

EXAMPLE

0.25
construction
boolean	
Optional

true for a construction line

Return	Type	Description
map	
startId
endId
skFitSpline (sketch is Sketch, splineId is string, value is map)

Create an interpolated spline through the given points.

Parameter	Type	Additional Info
value	map	
points
An array of points. If the start and end points are the same, the spline is closed.

EXAMPLE

[
    vector( 0,  0) * inch,
    vector( 0, -1) * inch,
    vector( 1,  1) * inch,
    vector(-1,  0) * inch,
    vector( 0,  0) * inch
]
parameters
Optional

An array of doubles, parameters corresponding to the points.

construction
boolean	
Optional

true for a construction line

startDerivative
Vector	
Optional

A 2D Vector with length units that specifies the derivative at the start of the resulting spline. Ignored if spline is closed.

endDerivative
Vector	
Optional

A 2D Vector with length units that specifies the derivative at the end of the resulting spline. Ignored if spline is closed.

skBezier (sketch is Sketch, bezierId is string, value is map)

Create a Bezier curve from the given control points.

Parameter	Type	Additional Info
value	map	
points
An array of points.

EXAMPLE

[
       vector( 0, 0) * inch,
       vector( 0, 1) * inch,
       vector( 1, 1) * inch,
       vector( 1, 0) * inch
]
construction
boolean	
Optional

true for a construction line

skRectangle (sketch is Sketch, rectangleId is string, value is map)

Add a rectangle (four line segments, properly constrained) to a sketch.

Parameter	Type	Additional Info
value	map	
firstCorner
Vector	
EXAMPLE

vector(0, 0) * inch
secondCorner
Vector	
EXAMPLE

vector(1, 1) * inch
construction
boolean	
Optional

true for a construction line

skRegularPolygon (sketch is Sketch, polygonId is string, value is map)

Add a regular polygon to the sketch. Unconstrained.

Parameter	Type	Additional Info
value	map	
center
Vector	
EXAMPLE

vector(0, 0) * inch
firstVertex
Vector	
Distance to the center determines the radius.

EXAMPLE

vector(0, 1) * inch
sides
number	
Number of polygon sides. Must be an integer 3 or greater.

construction
boolean	
Optional

true for a construction line

skPolyline (sketch is Sketch, polylineId is string, value is map)

Add a polyline (line segments, optionally with constrained endpoints) or a polygon to a sketch.

Parameter	Type	Additional Info
value	map	
points
array	
An array of points, each a Vector of two lengths. If first and last point are the same, the polyline is closed.

EXAMPLE

[
    vector( 0,  0) * inch,
    vector( 0, -1) * inch,
    vector( 1,  1) * inch,
    vector(-1,  0) * inch,
    vector( 0,  0) * inch
]
construction
boolean	
Optional

true for a construction line. Default false.

constrained
boolean	
Optional

true if constraints should be created. Default false.

skConstraint (sketch is Sketch, constraintId is string, value is map)

Add a constraint.

Parameter	Type	Additional Info
value	map	
constraintType
ConstraintType	
length
ValueWithUnits	
Optional

For constraints that require a length. Must have length units.

angle
ValueWithUnits	
Optional

For constraints that require a angle. Must have angle units.

query
Functions for constructing queries. Features that take queries as inputs should re-export this module.

Queries are used to refer to topological entities (vertices, edges, faces, and bodies) that FeatureScript operation and evaluation functions work on. A query is a map that contains instructions for how to find entities. For example, a query for all edges in a context looks like qEverything(EntityType.EDGE). Many queries can take subqueries as arguments, allowing for more complex nested queries.

Queries in general do not contain a list of entities in any form. Rather, they contain criteria that specify a subset of the topological entities in a context. To get an array of the entities (if any) which match a query in a context, use evaluateQuery. There is no need to evaluate a query before passing it into a function, including any of the Standard Library's operation and evaluation functions.

There are two general types of queries: state-based and historical. State-based queries select entities based on the model state, e.g. "All edges adjacent to a cylindrical face which touches this point." Historical queries select entities based on the model history, e.g. "the edge that was generated by feature extrude_1_id from sketch vertex vertex_id from sketch sketch_id." State-based queries cannot refer to entities that have been deleted. Most automatically-generated queries are historical, while queries more commonly used in manually written code are state-based.

Query type

A Query identifies a specific subset of a context's entities (points, lines, planes, and bodies).

The fields on a Query map depend on its QueryType, and may include one or more subqueries.

Value	Type	Description
Query	map	
queryType
QueryType	
entityType
EntityType	
Optional

canBeQuery (value) predicate

Typecheck for Query

BodyType enum

Specifies the topological type of a body.

All bodies have EntityType.BODY, but will generally own many entities of other EntityTypes.

For example, the result of an extrude with NewBodyOperationType.NEW is a body. This body will have BodyType.SOLID for a solid extrude, and BodyType.SHEET for a surface extrude. This extrude operation will create many geometric entities in the context (faces, edges, or vertices), which are owned by the body, and have the BodyType of their owning body.

See also

qBodyType

Value	Description
SOLID	
A three-dimensional part (e.g. the result of a solid extrude)

SHEET	
A two-dimensional sheet body (e.g. a sketch region, or the result of a surface extrude)

WIRE	
A one-dimensional curve (e.g. a sketch line or curve, or the result of opHelix)

POINT	
A zero-dimensional point (e.g. a sketch point, or the result of opPoint)

MATE_CONNECTOR	
A part studio mate connector.

COMPOSITE	
A composite part body, which can contain bodies of any other type

EntityType enum

Specifies the topological type of a given entity. Used in several queries as a filter, or on any query explicitly with qEntityFilter

Thus, one can obtain all the vertices in a part studio with qEverything(EntityType.VERTEX), and can obtain all the vertices attached to solid bodies with qBodyType(qEverything(EntityType.VERTEX), BodyType.SOLID)

A query for every part in a part studio is qBodyType(qEverything(EntityType.BODY), BodyType.SOLID)

Value	Description
VERTEX	
A zero-dimensional point or vertex

EDGE	
A one-dimensional line, curve, or edge

FACE	
A two-dimensional surface, planar face, or non-planar face

BODY	
A solid, surface, wire, or point body

AdjacencyType enum

Specifies the adjacency type of queried entities.

See also

qAdjacent

Value	Description
VERTEX	
Entities share at least a vertex

EDGE	
Entities share at least an edge

GeometryType enum

Specifies the geometric type of queried entities.

See also

qGeometry

Value	Description
LINE	
A straight line or edge

CIRCLE	
A circle of constant radius

ARC	
A segment of a circle

OTHER_CURVE	
Any one-dimensional entity which is not described above (e.g. splines, ellipses, etc.)

PLANE	
A construction plane or planar face

CYLINDER	
A surface which forms the side of a right circular cylinder

CONE	
A surface which forms the side of a right circular cone

SPHERE	
A surface which forms the boundary of a sphere

TORUS	
A surface which forms the boundary of a torus

REVOLVED	
A surface constructed by revolving a curve around an axis (unless it is simplified to one of the types above)

EXTRUDED	
A surface constructed by extruding or sweeping a curve along a line (unless it is simplified to one of the types above)

OTHER_SURFACE	
Any two-dimensional entity which is not described above (e.g. the side of an arbitrary loft)

ALL_MESH	
A surface or a body that is fully mesh or an edge between two mesh surfaces.

MIXED_MESH	
A body that contains both mesh and non-mesh surfaces or an edge between a mesh and a non-mesh surfaces.

MESH	
A surface that is mesh, a body that contains mesh surfaces or an edge bordering a mesh surface.

CapType enum

Specifies which cap queried entities should belong to.

See also

qCapEntity

Value	Description
START	
finds entities belonging to the start cap

END	
finds entities belonging to the end cap

EITHER	
finds entities belonging to either cap

ConstructionObject enum

Specifies whether the entity was created for construction (e.g. a construction line or construction plane).

Can be used in a filter on a query parameter to only allow certain selections:

annotation { "Name" : "Edges to use", "Filter" : EntityType.EDGE && ConstructionObject.NO }
definition.edges is Query;
See also

qConstructionFilter

Value	Description
YES	
Matches only entities which are created for construction

NO	
Matches only entities which are not created for construction

SMFlatType enum

Specifies whether an entity appears in the sheet metal flat view, or the main view.

See also

qSheetMetalFlatFilter

Value	Description
YES	
Matches entities which belong to a flattened sheet metal part.

NO	
Matches entities which do not belong to a flattened sheet metal part.

SMFormType enum

Specifies whether an entity is an artifact of a sheet metal form feature on flat pattern.

See also

qSheetMetalFormFilter

Value	Description
YES	
Matches entities which are artifacts of a sheet metal form feature on flat pattern.

NO	
Matches entities which are not artifacts of a sheet metal form feature on flat pattern.

AllowMeshGeometry enum

Specifies whether we allow meshes. Default is NO.

Can be used in a filter on a query parameter to only allow certain selections:

annotation { "Name" : "Bodies", "Filter" : EntityType.BODY && AllowMeshGeometry.YES }
definition.body is Query;
Value	Description
YES	
Allow meshes

NO	
Disallow meshes

AllowFlattenedGeometry enum

Specifies whether we allow flat entities. Default is NO.

Can be used in a filter on a query parameter to only allow certain selections:

annotation { "Name" : "Bodies", "Filter" : EntityType.BODY && AllowFlattenedGeometry.YES }
definition.body is Query;
Value	Description
YES	
Allow flat entities

NO	
Disallow flat entities

ActiveSheetMetal enum

Specifies whether the entities should belong to an active sheet metal model.

Can be used in a filter on a query parameter to only allow certain selections:

annotation { "Name" : "Sheet metal bodies", "Filter" : EntityType.BODY && ActiveSheetMetal.YES }
definition.body is Query;
Value	Description
YES	
matches only entities which belong to an active sheet metal model

NO	
matches only entities which do not belong to an active sheet metal model

SheetMetalDefinitionEntityType enum

Specifies geometry corresponding to a certain type of topological entity in the sheet metal master body for active sheet metal models.

Can be used in a filter on a query parameter to only allow certain selections:

annotation { "Name" : "Sheet metal definition edges", "Filter" : SheetMetalDefinitionEntityType.EDGE }
definition.entities is Query;
Value	Description
VERTEX	
matches entities defined by a sheet metal master body vertex. This includes vertices, edges, and faces at the corners, bend ends, fillets, and chamfers of sheet metal models.

EDGE	
matches entities defined by a sheet metal master body edge. This includes edges and faces along the sides of sheet metal walls.

FACE	
matches entities defined by a sheet metal master body face. This includes faces of sheet metal walls.

ModifiableEntityOnly enum

Specifies whether we allow modifiable only entities. It is default to NO.

Can be used in a filter on a query parameter to only allow certain selections:

annotation { "Name" : "Bodies", "Filter" : EntityType.BODY && ModifiableEntityOnly.YES }
definition.body is Query;
See also

qModifiableEntityFilter

Value	Description
YES	
Only allow modifiable entities

NO	
Allow both modifiable and unmodifiable entities

AllowEdgePoint enum

Specifies whether we allow edge points. Default is YES.

Can be used in a filter on a query parameter to only allow certain selections:

annotation { "Name" : "Corners", "Filter" : EntityType.VERTEX && AllowEdgePoint.NO }
definition.body is Query;
Value	Description
YES	
Allow edge points

NO	
Disallow edge points

MeshGeometry enum

Specifies whether the entities are mesh geometries.

See also

qMeshGeometryFilter

Value	Description
YES	
Matches only entities (edges, faces, and bodies) which are meshes

NO	
Matches only entities (edges, faces, and bodies) which are not meshes

SketchObject enum

Specifies whether the entity is a part of a sketch.

Can be used in a filter on a query parameter to only allow certain selections:

annotation { "Name" : "Sketch curves", "Filter" : EntityType.EDGE && SketchObject.YES }
definition.curves is Query;
See also

qSketchFilter

Value	Description
YES	
Matches only entities which are part of a sketch

NO	
Matches only entities which are not part of a sketch

QueryFilterCompound enum

A set of convenience filters, which are expanded during precondition processing. Can be used as a filter on query parameters, just like their corresponding expansions:

annotation { "Name" : "Axis", "Filter" : QueryFilterCompound.ALLOWS_AXIS }
definition.axis is Query;
Value	Description
ALLOWS_AXIS	
Equivalent to GeometryType.LINE || GeometryType.CIRCLE || GeometryType.ARC || GeometryType.CYLINDER || BodyType.MATE_CONNECTOR and can be processed with evAxis

ALLOWS_DIRECTION	
Equivalent to GeometryType.LINE || GeometryType.CIRCLE || GeometryType.ARC || GeometryType.CYLINDER || GeometryType.PLANE and can be processed with extractDirection

ALLOWS_PLANE	
Equivalent to GeometryType.PLANE || BodyType.MATE_CONNECTOR and can be processed with evPlane

ALLOWS_VERTEX	
Equivalent to EntityType.VERTEX || BodyType.MATE_CONNECTOR and can be processed with evVertexPoint

CompareType enum

Specifies a method of comparing two items.

See also

qFilletFaces

Value	Description
EQUAL	
LESS	
LESS_EQUAL	
GREATER	
GREATER_EQUAL	
Consumed enum

Specifies whether to filter or allow bodies (and their vertices, edges, and faces) consumed by closed composite parts.

See also

qConsumed

Value	Description
YES	
Matches only bodies that are consumed

NO	
Matches only bodies that are not consumed

CompositePartType enum

Specifies whether to filter or allow closed or open composite parts.

See also

qCompositePartTypeFilter

Value	Description
OPEN	
Matches only open composite parts

CLOSED	
Matches only closed composite parts

InContextObject enum

Specifies whether an entity is from an assembly context.

Can be used in a filter on a query parameter to only allow certain selections:

annotation { "Name" : "Edges to use", "Filter" : EntityType.EDGE && InContextObject.NO }
definition.edges is Query;
Value	Description
YES	
Matches only entities which are from an assembly context

NO	
Matches only entities which are not from an assembly context

qNothing () returns Query

An empty query, which does not resolve to any entities.

qEverything (entityType is EntityType) returns Query

A query for all entities of a specified EntityType in the context.

See also

qAllModifiableSolidBodies

Parameter	Type	Additional Info
entityType	EntityType	
Optional

qEverything () returns Query

A query for all entities in the context.

qAllNonMeshSolidBodies () returns Query

A query for all solid bodies that do not have mesh geometry.

qAllSolidBodies () returns Query

A query for all solid bodies.

qAllModifiableSolidBodiesNoMesh () returns Query

A query for all solid bodies that do not have mesh geometry or in context geometry, i.e. every non-mesh-containing part displayed in the Part Studio's "Parts" list.

See also

qAllModifiableSolidBodies

qAllModifiableSolidBodies () returns Query

A query for all modifiable solid bodies, including mesh-containing bodies.

See also

qAllModifiableSolidBodiesNoMesh

qNthElement (queryToFilter is Query, n is number) returns Query

A query for one entity in queryToFilter at a specified index. The order of entities resolved by a query is deterministic but arbitrary.

Parameter	Type	Additional Info
queryToFilter	Query	
A query which resolves to at least n+1 entities

n	number	
Zero-based index of entity in queryToFilter.

EXAMPLE

0 indicates the first entity
EXAMPLE

-1 indicates the last entity
qEntityFilter (queryToFilter is Query, entityType is EntityType) returns Query

A query for entities in a queryToFilter which match a given EntityType.

qHasAttribute (name is string) returns Query

Query for all entities marked with an attribute with name name

See also

setAttribute

qHasAttribute (queryToFilter is Query, name is string) returns Query

Query for all entities in queryToFilter marked with an attribute with name name

See also

setAttribute

qHasAttributeWithValue (name is string, value) returns Query

Query for all entities marked with an attribute with name name and value exactly equal to value

See also

setAttribute

qHasAttributeWithValue (queryToFilter is Query, name is string, value) returns Query

Query for all entities in queryToFilter marked with an attribute with name name and value exactly equal to value

See also

setAttribute

qHasAttributeWithValueMatching (name is string, attributePattern is map) returns Query

Query for all entities marked with an attribute with name name and a map value matching every key-value pair in the provided attributePattern map.

See also

setAttribute

Parameter	Type	Additional Info
attributePattern	map	
EXAMPLE

{
    "key1" : valueToMatch,
}
qHasAttributeWithValueMatching (queryToFilter is Query, name is string, attributePattern is map) returns Query

Query for all entities in queryToFilter marked with an attribute with name name and a map value matching every key-value pair in the provided attributePattern map.

See also

setAttribute

Parameter	Type	Additional Info
attributePattern	map	
EXAMPLE

{
    "key1" : valueToMatch,
}
qAttributeFilter (queryToFilter is Query, attributePattern) returns Query

Note: This query is used only for legacy unnamed attributes, which are still supported but no longer reccommended. See the Attributes module for details.

A query for entities in a queryToFilter which have been assigned a legacy unnamed attribute matching a given attributePattern.

Parameter	Type	Additional Info
attributePattern		
Will only resolve to queries whose legacy unnamed attributes match the type (and possibly the values) of this pattern.

If attributePattern has a type tag, will only match attributes with that same type tag.

EXAMPLE

{} as MyCustomType will match all attributes with type tag MyCustomType
If the attribute has no type tag (i.e. it is a standard type like string or map), will match all attributes with that same standard type.

EXAMPLE

"asdf" will match all string attributes.
EXAMPLE

{} will match all map attributes.
If the attribute is a map, will only match maps which have identical values for every key-value pair in the pattern

EXAMPLE

{ "odd" : true } matches all unnamed map attributes that have a field "odd" whose value is true.
EXAMPLE

{ "odd" : true } as MyCustomType matches all unnamed map attributes with the that have a field "odd" whose value is true.
qAttributeQuery (attributePattern) returns Query

Note: This query is used only for legacy unnamed attributes, which are still supported but no longer reccommended. See the Attributes module for details.

A query for all entities which have been assigned a legacy unnamed attribute matching a given attributePattern. Equivalent to qAttributeFilter(qEverything(), attributePattern)

qCreatedBy (featureId is Id, entityType is EntityType) returns Query

A query for all the entities created by a feature or operation. The feature is given by its feature id, which was passed into the the operation function in order to create the feature.

An entity is "created by" an operation if the entity was added to the context as part of that operation. Entities modified, but not created, by an operation are not returned by this query.

If an entity is split (as in a split part operation), the resulting entities are "created by" both the original entity's creator and the split part operation.

If two entities are merged (as in a union of coincident faces), that entity is "created by" the creators of each merged entity, as well as the merging operation itself.

If a sketch's feature id is specified, returns a query for all sketch regions, points, and wire bodies created by the specified sketch.

Parameter	Type	Additional Info
featureId	Id	
The Id of the specified feature.

EXAMPLE

id + "extrude1"
entityType	EntityType	
Optional

qCreatedBy (featureId is Id) returns Query

qCreatedBy (features is FeatureList) returns Query

qCreatedBy (features is FeatureList, entityType is EntityType) returns Query

qCapEntity (featureId is Id, capType is CapType, entityType is EntityType) returns Query

A query for start/end cap vertex, edge, and face entities created by featureId. Cap entities are produced by extrude, revolve, sweep, loft and thicken features

Parameter	Type	Additional Info
entityType	EntityType	
Optional

qCapEntity (featureId is Id, capType is CapType) returns Query

qNonCapEntity (featureId is Id, entityType is EntityType) returns Query

A query for vertex, edge, and face entities created by featureId that are not cap entities. Cap entities are produced by extrude, revolve, sweep, loft and thicken features

Parameter	Type	Additional Info
entityType	EntityType	
Optional

qNonCapEntity (featureId is Id) returns Query

qOpHoleProfile (featureId is Id, filters is map) returns Query

A query for the profile edges or vertices created by an opHole operation.

Parameter	Type	Additional Info
featureId	Id	
The Id of the specified operation.

EXAMPLE

id + "hole1"
filters	map	
name
string	
Optional

Filter the query for profiles with a given name. See name field of HoleProfile.

identity
Query	
Optional

Filter the query for the hole associated with the given identity entity. See identities parameter of opHole.

qOpHoleProfile (featureId is Id) returns Query

qOpHoleFace (featureId is Id, filters is map) returns Query

A query for the hole faces created by an opHole operation.

Parameter	Type	Additional Info
featureId	Id	
The Id of the specified operation.

EXAMPLE

id + "hole1"
filters	map	
name
string	
Optional

Filter the query for faces with a given name. See faceNames field of HoleDefinition.

identity
Query	
Optional

Filter the query for the hole associated with the given identity entity. See identities parameter of opHole.

qOpHoleFace (featureId is Id) returns Query

qToleranceFilter (queryToFilter is Query) returns Query

qUnion (subqueries is array) returns Query

A query for entities which match any of a list of queries.

qUnion is guaranteed to preserve order. That is, entities which match queries earlier in the subqueries input list will also be listed earlier in the output of evaluateQuery.

qUnion (query1 is Query, query2 is Query) returns Query

qUnion (query1 is Query, query2 is Query, query3 is Query) returns Query

qUnion (query1 is Query, query2 is Query, query3 is Query, query4 is Query) returns Query

qIntersection (subqueries is array) returns Query

A query for entities which match all of a list of queries. qIntersection preserves the order of the first subquery.

qIntersection (query1 is Query, query2 is Query) returns Query

qSubtraction (query1 is Query, query2 is Query) returns Query

A query for entities which match query1, but do not match query2. qSubtraction preserves the order of query1.

qSymmetricDifference (query1 is Query, query2 is Query) returns Query

A query for entities which match either query1 or query2, but not both.

qOwnedByBody (body is Query, entityType is EntityType) returns Query

A query for all of the entities (faces, vertices, edges, and bodies) in a context which belong to a specified body or bodies.

Parameter	Type	Additional Info
entityType	EntityType	
Optional

qOwnedByBody (body is Query) returns Query

qOwnedByBody (queryToFilter is Query, body is Query) returns Query

A query for all of the entities which match a queryToFilter, and belong to the specified body or bodies.

qOwnerBody (entities is Query) returns Query

A query for each body that any of the given entities belong to.

If a body is passed in, the result will include that body itself.

qContainedInCompositeParts (compositeParts is Query) returns Query

A query for each part contained in compositeParts.

qCompositePartsContaining (bodies is Query) returns Query

A query for each composite part containing bodies.

qCompositePartsContaining (bodies is Query, compositePartType is CompositePartType) returns Query

A query for each composite part of the given type containing bodies.

qFlattenedCompositeParts (entities is Query) returns Query

A query for non-composite entities in entities and constituents of composite parts in entities.

qConsumed (queryToFilter is Query, consumed is Consumed) returns Query

A query for all entities in queryToFilter which are consumed by any closed composite part, or all entities of queryToFilter which are not consumed by any closed composite part.

qCompositePartTypeFilter (queryToFilter is Query, compositePartType is CompositePartType) returns Query

A query for all bodies in queryToFilter which are either open or closed composite parts, depending on the second parameter.

qSourceMesh (selectedMeshVertices is Query, entityType is EntityType) returns Query

A query for each mesh element that any selectedMeshVertices belong to. selectedMeshVertices should be the point bodies created when a user selects a mesh vertex. Mesh vertices which have not been selected cannot be queried in FeatureScript

Parameter	Type	Additional Info
selectedMeshVertices	Query	
One or more mesh vertices whose owning elements are queried.

entityType	EntityType	
The type of resulting entities. Can be EntityType.BODY, EntityType.FACE or EntityType.EDGE.

qSourceMesh (selectedMeshVertices is Query) returns Query

Deprecated: Use qSourceMesh with EntityType.BODY

qAdjacent (seed is Query, adjacencyType is AdjacencyType, entityType is EntityType) returns Query

A query for entities that are adjacent to the given seed entities.

Parameter	Type	Additional Info
seed	Query	
One or more entities whose adjacent neighbors are queried. The result does not include the original seed entities (unless they are adjacent to other seed entities)

adjacencyType	AdjacencyType	
EXAMPLE

AdjacencyType.VERTEX will return entities that share at least a vertex with the seed entities.
EXAMPLE

AdjacencyType.EDGE will return entities that share at least an edge with the seed entities. For example, qAdjacent(whiteSquareOnChessBoard, AdjacencyType.EDGE) would return all four surrounding black squares, but not the four diagonal white squares.
entityType	EntityType	
Optional

The type of resulting entities

qAdjacent (seed is Query, adjacencyType is AdjacencyType) returns Query

qVertexAdjacent (query is Query, entityType is EntityType) returns Query

Deprecated: Use qAdjacent with AdjacencyType.VERTEX

qEdgeAdjacent (query is Query, entityType is EntityType) returns Query

Deprecated: Use qAdjacent with AdjacencyType.EDGE

qEdgeTopologyFilter (queryToFilter is Query, edgeTopologyType is EdgeTopology) returns Query

A query for edges in a queryToFilter which match a given EdgeTopology.

qEdgeVertex (edgeQuery is Query, atStart is boolean)

A query for the start or end vertices of edges.

qGeometry (queryToFilter is Query, geometryType is GeometryType) returns Query

A query for all entities in queryToFilter with a specified GeometryType.

qBodyType (queryToFilter is Query, bodyType is BodyType) returns Query

A query for all entities in queryToFilter which are bodies of the a specified BodyType, or are owned by bodies with the specified BodyType

qBodyType (queryToFilter is Query, bodyTypes is array) returns Query

A query for all entities in queryToFilter with any of a list of BodyTypes.

Parameter	Type	Additional Info
bodyTypes	array	
An array of BodyTypes.

qConstructionFilter (queryToFilter is Query, constructionFilter is ConstructionObject) returns Query

A query for all construction entities or all non-construction entities in queryToFilter.

See also

ConstructionObject

qActiveSheetMetalFilter (queryToFilter is Query, activeSheetMetal is ActiveSheetMetal) returns Query

A query for all entities in queryToFilter belonging to an active sheet metal part.

See also

ActiveSheetMetal

qSheetMetalFlatFilter (queryToFilter is Query, filterFlat is SMFlatType) returns Query

A query for all entities in queryToFilter belonging to a flattened sheet metal part.

See also

SMFlatType

qSMFlatFilter (subquery is Query, filterFlat is SMFlatType) returns Query

Deprecated: Use qSheetMetalFlatFilter

qSheetMetalFormFilter (queryToFilter is Query, filterForm is SMFormType) returns Query

A query for all entities in queryToFilter that are artifacts of a sheet metal form feature on flat pattern.

See also

SMFormType

qPartsAttachedTo (sheetMetalEntities is Query) returns Query

A query for parts to which sheetMetalEntities are attached (e.g. sheet metal bend line entities are attached to a flattened sheet metal part)

qCorrespondingInFlat (entitiesInFolded is Query) returns Query

A query for entities in sheet metal flattened body corresponding to any entitiesInFolded which are part of 3D sheet metal bodies

qSMDefinitionEntityFilter (queryToFilter is Query, entityType is EntityType) returns Query

A query for sheet metal definition entities in a queryToFilter which match a given EntityType.

See also

SheetMetalDefinitionEntityType

qMeshGeometryFilter (queryToFilter is Query, meshGeometryFilter is MeshGeometry) returns Query

A query for all mesh entities or all non-mesh entities in queryToFilter.

A body is considered a "mesh entity" if any of its faces or edges have mesh geometry.

See also

MeshGeometry

qModifiableEntityFilter (queryToFilter is Query) returns Query

A query for all modifiable entities in queryToFilter.

An entity is considered non-modifiable if it is an in-context entity.

See also

ModifiableEntityOnly

qAllModifiableSolidBodies

qSketchFilter (queryToFilter is Query, sketchObjectFilter is SketchObject) returns Query

A query for all sketch entities, or all non-sketch entities in queryToFilter.

qParallelPlanes (queryToFilter is Query, referencePlane is Plane, allowAntiparallel is boolean) returns Query

A query for all planar face entities that are parallel to the referencePlane.

Parameter	Type	Additional Info
referencePlane	Plane	
The plane to reference when checking for parallelism.

allowAntiparallel	boolean	
Whether to also return entities that are antiparallel.

qParallelPlanes (queryToFilter is Query, referencePlane is Plane) returns Query

A query for all planar face entities in queryToFilter that are parallel to the referencePlane.

Parameter	Type	Additional Info
referencePlane	Plane	
The plane to reference when checking for parallelism.

qParallelPlanes (queryToFilter is Query, normal is Vector, allowAntiparallel is boolean) returns Query

A query for all planar face entities in queryToFilter that are parallel to a plane specified by the normal vector.

Parameter	Type	Additional Info
normal	Vector	
The normal vector to reference when checking for parallelism.

allowAntiparallel	boolean	
Whether to also return entities that are antiparallel.

qPlanesParallelToDirection (queryToFilter is Query, direction is Vector) returns Query

A query for all planar faces in queryToFilter that are parallel to the given direction vector (i.e., the plane normal is perpendicular to direction).

qFacesParallelToDirection (queryToFilter is Query, direction is Vector) returns Query

A query for all faces in queryToFilter that are parallel to the given direction vector e.g. if it is a planar face, the plane normal is perpendicular to direction if it is a cylindrical face, the axis is parallel to direction if it is an extruded face, the extrude direction is parallel to direction

qParallelPlanes (queryToFilter is Query, normal is Vector) returns Query

A query for all planar face entities in queryToFilter that are parallel to a plane specified by the normal vector.

Parameter	Type	Additional Info
normal	Vector	
The normal vector to reference when checking for parallelism.

qConvexConnectedFaces (seed is Query) returns Query

A query for a set of faces connected to seed via convex edges, flood-filling across any number of convex edges.

A convex edge is an edge which forms a convex angle along the full length of the edge. A convex angle is strictly less than 180 degrees for flat faces, or faces with negative curvature. If one face has positive curvature, and the other has flat or positive curvature, a convex angle is less than or equal to 180 degrees. Thus, the two bounding edges of an exterior fillet are considered convex.

qConcaveConnectedFaces (seed is Query) returns Query

A query for a set of faces connected to seed via concave edges, flood-filling across any number of concave edges.

A concave edge is an edge which forms a concave angle along the full length of the edge. A concave angle is strictly greater than 180 degrees for flat faces, or faces with positive curvature. If one face has negative curvature, and the other has flat or negative curvature, a concave angle is less than or equal to 180 degrees. Thus, the two bounding edges of an interior fillet are considered concave.

qTangentConnectedFaces (seed is Query) returns Query

A query for a set of faces connected to seed via tangent edges, flood-filling across any number of tangent edges.

A tangent edge is an edge joining two faces such that the surface direction is continuous across the edge, at every point along the full length of the edge.

qTangentConnectedFaces (seed is Query, angleTolerance is ValueWithUnits) returns Query

A query for a set of faces connected to seed via tangent edges, flood-filling across any number of tangent edges.

A tangent edge is an edge joining two faces such that the surface direction is continuous across the edge, up to the given angleTolerance, at every point along the full length of the edge.

qTangentConnectedEdges (seed is Query) returns Query

A query for a chain of tangent edges connected to seed via tangent vertices, chaining across any number of tangent vertices.

qLoopEdges (seed is Query) returns Query

A query for a set of edges defining a loop. If the seed has laminar edges, this query will extend to include all laminar loops that contain any seed edges. If the seed has faces, the result will include the loops forming the outer boundary of the joined faces.

The order of entities returned by this function is arbitrary (and generally not predictable). Use constructPath to order the results.

qParallelEdges (queryToFilter is Query, direction is Vector) returns Query

A query for all linear edges in queryToFilter which are parallel (or anti-parallel) to the given direction.

qParallelEdges (queryToFilter is Query, edges is Query) returns Query

A query to find all linear edges in queryToFilter which are parallel (or anti-parallel) to any linear edge in edges.

qLoopBoundedFaces (faceAndEdge is Query) returns Query

Given a face and an edge, query for all faces bounded by the given face, on the side of the given edge.

For example, to select an entire pocket, pass in the face which surrounds the pocket, and an edge of the face which touches that pocket.

Parameter	Type	Additional Info
faceAndEdge	Query	
Should match a face and an edge. If multiple faces and edges match, used the first face and the first edge.

qFaceOrEdgeBoundedFaces (faceAndBoundingEntities is Query) returns Query

Given a seed face and bounding entities, matches all adjacent faces inside the bounding entities, expanding from the seed face.

Parameter	Type	Additional Info
faceAndBoundingEntities	Query	
A Query for the seed face, followed by any boundary faces or edges. The seed face must be first, so a qUnion should be used to guarantee the order.

qHoleFaces (seed is Query) returns Query

Given a single face inside a hole or hole-like geometry, returns all faces of that hole.

Parameter	Type	Additional Info
seed	Query	
A query for a single face inside the hole.

qSketchRegion (featureId is Id, filterInnerLoops is boolean) returns Query

A query for all fully enclosed, 2D regions created by a sketch.

Parameter	Type	Additional Info
featureId	Id	
The feature id of the Sketch being queried.

filterInnerLoops	boolean	
Optional

Specifies whether to exclude sketch regions fully contained in other sketch regions. A region whose border has a vertex or edge on the outside boundary is not considered "contained." Default is false.

qSketchRegion (featureId is Id) returns Query

qUniqueVertices (vertices is Query) returns Query

A query that filters out duplicate vertices. When duplicates are found, the vertex with the lowest deterministic ID is used.

qMateConnectorsOfParts (parts is Query) returns Query

A query for all mate connectors owned by parts.

qFilletFaces (facesToCompareTo is Query, compareType is CompareType) returns Query

A query for fillet faces of radius equal to, less than or equal to, or greater than or equal to the input faces. If facesToCompareTo does not match one or more fillet faces, the resulting query will not match any faces. Will find the fillet radius from each face and compare to find faces of all fillets on that body that satisfy the compareType.

If facesToCompareTo resolves to multiple fillet faces, all are matched independently. That is, qFilletFaces(qUnion([q1, q2], compareType)) returns the same thing as qUnion([qFilletFaces(q1, compareType), qFilletFaces(q2, compareType)]).

qMatching (referenceEntities is Query) returns Query

Matches any faces or edges within owner bodies of entities in referenceEntities which are geometrically identical (same size and shape) to the face or edge in referenceEntities.

If referenceEntities resolves to multiple entities, all are matched independently. That is, qMatching(qUnion([q1, q2])) returns the same thing as qUnion([qMatching(q1), qMatching(q2)]).

qPatternInstances (featureId is Id, instanceNames is array, entityType is EntityType) returns Query

A query for entities created by a specific instance or instances of an opPattern operation.

Parameter	Type	Additional Info
featureId	Id	
The Id of the specified feature.

EXAMPLE

id + "pattern1"
instanceNames	array	
The names of the instances to query for, a subset of the instanceNames passed into the opPattern operation.

qPatternInstances (featureId is Id, instanceName is string, entityType is EntityType) returns Query

qDependency (dependentEntities is Query) returns Query

A query for the true dependency of the given dependentEntities. For instance, the true dependency of the extruded body will be the face or sketch edges of the profile from which it is extruded.

qLaminarDependency (dependentEntities is Query) returns Query

A query for the true dependency of the given dependentEntities, specifically for use with wire edges that have been created from laminar edges. If the immediate dependency is not laminar then it will track back until it reaches a laminar dependency (if there is one).

qContainsPoint (queryToFilter is Query, point is Vector) returns Query

A query for all entities (bodies, faces, edges, or points) in queryToFilter containing a specified point.

Parameter	Type	Additional Info
point	Vector	
A 3D point, in world space.

qIntersectsLine (queryToFilter is Query, line is Line) returns Query

A query for all entities (bodies, faces, edges, or points) in queryToFilter touching a specified infinite line.

qIntersectsPlane (queryToFilter is Query, plane is Plane) returns Query

A query for all entities (bodies, faces, edges, or points) in queryToFilter touching a specified infinite plane.

Parameter	Type	Additional Info
plane	Plane	
EXAMPLE

plane(vector(0, 0, 0) * meter, vector(0, 0, 1))
qInFrontOfPlane (queryToFilter is Query, plane is Plane) returns Query

A query for all entities (bodies, faces, edges, or points) in queryToFilter in front of a specified infinite plane. Entities intersecting the plane will not be resolved. Only entities completely on one side or coincident with the plane will be selected. Use flip(plane) to query entities on the other side of the plane. For example, for the XY plane through the origin with the normal (0, 0, 1), qInFrontOfPlane will resolve the vertices (1, 1, 0) and (1, 1, 1) but not the vertex (1, 1, -1).

Parameter	Type	Additional Info
plane	Plane	
EXAMPLE

plane(vector(0, 0, 0) * meter, vector(0, 0, 1))
qCoincidesWithPlane (queryToFilter is Query, plane is Plane) returns Query

A query for all entities (bodies, faces, edges, or points) in queryToFilter coinciding with a specified infinite plane.

Parameter	Type	Additional Info
plane	Plane	
EXAMPLE

plane(vector(0, 0, 0) * meter, vector(0, 0, 1))
qWithinRadius (queryToFilter is Query, point is Vector, radius is ValueWithUnits) returns Query

A query for all entities (bodies, faces, edges or points) in queryToFilter that are within a specified radius from a point.

Parameter	Type	Additional Info
point	Vector	
The point from which to check distance from.

radius	ValueWithUnits	
The distance away from the point.

qClosestTo (queryToFilter is Query, point is Vector) returns Query

A query for the entity in queryToFilter closest to a point.

In the case of a tie, resolves to all entities within TOLERANCE.zeroLength of being the closest.

Parameter	Type	Additional Info
point	Vector	
A position vector for the point to find entities closest to.

qFarthestAlong (queryToFilter is Query, direction is Vector) returns Query

A query for the entity in queryToFilter farthest along a direction in world space. In the case of a tie, resolves to all entities within TOLERANCE.zeroLength of being the farthest.

Parameter	Type	Additional Info
direction	Vector	
A vector for the direction to find the entity farthest away.

qLargest (queryToFilter is Query) returns Query

A query to find the largest entity (by length, area, or volume) in queryToFilter.

If queryToFilter contains entities of different dimensionality (e.g. both solid bodies and faces), only entities of the highest dimension are considered. Entities are compared by length, area or volume. Multiple entities may be returned if they tie within tolerance.

qSmallest (queryToFilter is Query) returns Query

A query to find the smallest entity (by length, area, or volume) in queryToFilter.

If queryToFilter contains entities of different dimensionality (e.g. solid bodies and faces), only entities of the highest dimension are considered. Entities are compared by length, area or volume. Multiple entities may be returned if they tie within tolerance.

qEdgeConvexityTypeFilter (queryToFilter is Query, edgeconvexitytype is EdgeConvexityType) returns Query

A query that filters given edges by convexity.

Returns a query containing all edges from queryToFilter that have convexity type edgeConvexityType.

See also

evEdgeConvexity .

qAxis (queryToFilter is Query, axis is Line) returns Query

A query that filters edges and faces into axis-symmetric ones (lines, circles, cylinders, cones, tori, revolved, mate connectors) that have the given axis. The sign of the axis direction does not matter.

See also

evAxis .

dummyQuery (operationId is Id, entityType is EntityType) returns Query

qSplitBy (featureId is Id, entityType, backBody is boolean) returns Query

Given the id of a split feature, get entities of a given EntityType on the front or the back side of the split. For a split by face or part, the front denotes the body in the direction of the split tool's surface normal, and the back denotes the body opposite the normal. For a split by isocline, the front denotes non-steep faces and edges, and the back denotes steep entities.

Parameter	Type	Additional Info
featureId	Id	
EXAMPLE

id + "split1"
backBody	boolean	
EXAMPLE

false indicates the entities in the front.
EXAMPLE

true indicates the entities in the back.
sketchEntityQuery (operationId is Id, entityType, sketchEntityId is string) returns Query

Gets the wire body entities created for a specific sketch entity. If the sketch id created multiple sketch entities, will return all the wire bodies.

Parameter	Type	Additional Info
operationId	Id	
Id of the sketch feature.

entityType		
EXAMPLE

EntityType.EDGE to match the edges on the wire bodies.
EXAMPLE

EntityType.BODY to match the bodies themselves.
EXAMPLE

undefined to match both.
sketchEntityId	string	
Sketch id.

evaluateQuery (context is Context, query is Query) returns array

Returns an array of queries for the individual entities in a context which match a specified query. The returned array contains exactly one transient query for each matching entity at the time of the call. If the context is modified, the returned queries may become invalid and no longer match an entity.

It is usually not necessary to evaluate queries, since operation and evaluation functions can accept non-evaluated queries. Rather, the evaluated queries can be used to count the number of entities (if any) that match a query, or to iterate through the list to process entities individually.

The order of entities returned by this function is arbitrary (and generally not predictable) except in the case of a qUnion query. In that case, the entities matched by earlier queries in the argument to qUnion are returned first.

areQueriesEquivalent (context is Context, first is Query, second is Query) returns boolean

Returns true if the supplied queries evaluate to the same set of entities. This function is order-invariant, so if the two queries evaluate to the same entities, but in a different order, the function will still return true.

isQueryEmpty (context is Context, query is Query) returns boolean

Returns true if query evaluates to nothing. Equivalent to evaluateQuery(context, query) == [] or size(evaluateQuery(context, query)) == 0, but faster than either of those approaches if the query is not empty.

evaluateQueryCount (context is Context, query is Query) returns number

Returns the number of entities returned by the supplied query. Equivalent to size(evaluateQuery(context, query)), but faster.

evaluate
Evaluation functions return information about the topological entities in the context, like bounding boxes, tangent planes, projections, and collisions. Evaluation functions take a context and a map that specifies the computation to be performed and return a ValueWithUnits, a FeatureScript geometry type (like Line or Plane), or a special type like DistanceResult. They may also throw errors if a query fails to evaluate or the input is otherwise invalid.

evApproximateCentroid (context is Context, arg is map) returns Vector

Find the centroid of an entity or group of entities. This is equivalent to the center of mass for a constant density object. Warning: This is an approximate value and it is not recommended to use this for modeling purposes that will be negatively affected in case the approximation changes. Consider using the center of a bounding box instead.

Parameter	Type	Additional Info
arg	map	
entities
Query	
The entities to take the center of mass of.

MassProperties type

The result of an evApproximateMassProperties call.

Value	Type	Description
MassProperties	map	
mass
ValueWithUnits	
The total mass.

centroid
Vector	
The center of mass with respect to the given reference frame, or with respect to the origin if a reference frame is not specified.

inertia
MatrixWithUnits	
The 3D inertia tensor, with units of mass * length ^ 2. Evaluated with respect to the reference frame, or with respect to the centroid if a reference frame is not specified.

volume
ValueWithUnits	
Total volume. Only returned for solid bodies.

area
ValueWithUnits	
Total area. Only returned for faces.

length
ValueWithUnits	
Total length. Only returned for edges.

count
number	
Total count. Only returned for vertices.

evApproximateMassProperties (context is Context, arg is map) returns MassProperties

Calculates approximate mass properties of an entity or group of entities. Returns mass, centroid, inertia tensor, and volume/area/length/count for bodies/faces/edges/vertices, respectively. Warning: These are approximate values and it is not recommended to use them for modeling purposes that will be negatively affected in case the approximation changes.

Parameter	Type	Additional Info
arg	map	
entities
Query	
The entities of which to compute mass properties. Only entities of the highest dimensionality will be considered.

density
ValueWithUnits	
The density of the entities, with appropriate units.

EXAMPLE

1 * kilogram / meter ^ 3 could be the density of 3D solid bodies
EXAMPLE

1 * kilogram / meter ^ 2 could be the density of 2D faces or sheet bodies
EXAMPLE

1 * kilogram / meter could be the density of 1D edges or wire bodies
EXAMPLE

1 * kilogram could be the mass of each 0D vertex or point body
referenceFrame
CoordSystem	
Optional

Optional coordinate system. Defaults to the centroid with world axes for the inertia tensor, and world coordinates for the centroid.

evArea (context is Context, arg is map) returns ValueWithUnits

Return the total area of all the entities. If no matching 2D faces are found the total area will be zero.

Parameter	Type	Additional Info
arg	map	
entities
Query	
evAxis (context is Context, arg is map) returns Line

If the query finds one entity with an axis -- a line, circle, cylinder, cone, sphere, torus, mate connector, or revolved surface -- return the axis. Otherwise throw an exception.

Parameter	Type	Additional Info
arg	map	
axis
Query	
evBox3d (context is Context, arg is map) returns Box3d

Find a bounding box around an entity, optionally with respect to a given coordinate system. There is also an option to use a faster but less accurate method.

Parameter	Type	Additional Info
arg	map	
topology
Query	
The entity to find the bounding box of.

cSys
CoordSystem	
Optional

The coordinate system to use (if not the standard coordinate system).

tight
boolean	
Optional

Get the tightest possible bounding box. Defaults to true.

EXAMPLE

true for a bounding box precisely at the extents of the given entities (and no bigger).
EXAMPLE

false for a bounding box at least as big as the given entities, using a faster algorithm.
evCollision (context is Context, arg is map) returns array

Find collisions between tools and targets. Each collision is a map with field type of type ClashType and fields target, targetBody, tool, and toolBody of type Query.

Parameter	Type	Additional Info
arg	map	
tools
Query	
targets
Query	
evCornerType (context is Context, arg is map) returns map

Return the type of corner found at a vertex of a sheet metal model

Parameter	Type	Additional Info
arg	map	
vertex
Query	
Return	Type	Description
map	
cornerType
SMCornerType	
the type of the corner

primaryVertex
Query	
the vertex that defines the corner

allVertices
array	
array of transient queries for all definition vertices associated with the corner

Throws	Additional info
GBTErrorStringEnum.BAD_GEOMETRY	
The query does not evaluate to a single vertex

evCurveDefinition (context is Context, arg is map) returns map

Given a query for a curve, return a Circle, Ellipse, Line, or BSplineCurve value for the curve. If the curve is none of these types, return a map with unspecified contents.

Parameter	Type	Additional Info
arg	map	
edge
Query	
The curve to evaluate.

returnBSplinesAsOther
boolean	
Optional

If true, do not return B-spline curves (to avoid the associated time cost). Default is false.

Throws	Additional info
GBTErrorStringEnum.INVALID_INPUT	
The first resolved entity was not an edge.

GBTErrorStringEnum.CANNOT_RESOLVE_ENTITIES	
Input entities are invalid or there are no input entities.

evApproximateBSplineCurve (context is Context, arg is map) returns BSplineCurve

Given a query for a curve, return its approximation (or exact representation if possible) as a B-spline. The options forceCubic and forceNonRational may be used to restrict the type of spline that is returned, but even if these options are false, a cubic non-rational spline may be returned.

Parameter	Type	Additional Info
arg	map	
edge
Query	
The curve to approximate.

forceCubic
boolean	
Optional

If true, a cubic spline will be returned. Defaults to false.

forceNonRational
boolean	
Optional

If true, a non-rational spline will be returned. Defaults to false.

tolerance
number	
Optional

Specifies the desired approximation tolerance: the maximum distance (in meters) between the original curve and the returned spline representation. Default is 1e-6, minimum is 1e-8, and maximum is 1e-2.

DistanceResult type

The result of an evDistance call -- information about the extremal distance and the attaining point / line / entity.

Value	Type	Description
DistanceResult	map	
distance
ValueWithUnits	
The minimal or maximal distance.

sides
array	
An array of 2 maps, containing information about where the extremum was found for each side. Each map has a:

point (Vector) : The position in world space that is closest or farthest to the other side. The distance field is measured between the two values of point.

index (integer) : the index into the line or point array or into the query results, if a query is passed in.

parameter (number or length or array of two numbers) : If the index refers to an edge, the parameter is a number between 0 and 1 (unless extend for that side was passed in). It is in the form that evEdgeTangentLine and evEdgeCurvature consume (with arcLengthParameterization set to the same value that was passed into evDistance).

If the index refers to a point, the parameter is 0.

If the index refers to a Line, the parameter is a length representing the distance along the direction.

If the index refers to a face, the parameter is a 2D Vector in the form that evFaceTangentPlane consumes. If this face is a mesh or a plane, the parameter is a 2D Vector of zeroes.

If the index refers to a Plane, the parameter is a 2D Vector representing the lengths along the plane's x and y axes.

evDistance (context is Context, arg is map) returns DistanceResult

Computes the minimum or maximum distance between geometry on side0 and geometry on side1. "Geometry" means entities, points, or lines. When the minimum or the maximum is not uniquely defined, ties will be broken arbitrarily.

EXAMPLE

evDistance(context, { "side0" : vector(1, 2, 3) * meter, "side1" : query }).distance returns the minimum distance from any entity returned by query to the point (1, 2, 3) meters.
EXAMPLE

result = evDistance(context, { "side0" : qEverything(EntityType.VERTEX), "side1" : qEverything(EntityType.VERTEX), "maximum" : true }) computes the pair of vertices farthest apart. qNthElement(qEverything(EntityType.VERTEX), result.sides[0].index) queries for one of these vertices.
See also

DistanceResult

Parameter	Type	Additional Info
arg	map	
side0
One of the following: A query, or a point (3D Length Vector), or a Line, or a Plane, or an array of points, or an array of Lines, or an array of Planes.

EXAMPLE

qNthElement(qEverything(EntityType.FACE), 0) or vector(1, 2, 3) * meter or line(vector(1, 0, 1) * meter, vector(1, 1, 1) or plane(vector(1,1,1) * meter, vector(0,0,1), vector(1,0,0)).
extendSide0
boolean	
Optional

If true and side0 is a query, bodies will be ignored and edges and faces extended to their possibly infinite underlying surfaces. Defaults to false.

side1
Like side0.

extendSide1
boolean	
Optional

Like extendSide0.

maximum
boolean	
Optional

If true, compute the maximum instead of the minimum. Defaults to false. Not allowed to be true if a line is passed in in either side or if either extend is true.

arcLengthParameterization
boolean	
Optional

If true (default), the parameter returned for edges measures distance along the edge, so 0.5 is the midpoint. If false, use an arbitrary but faster-to-calculate parameterization. This field only controls the parameter returned for edges. It does not control the parameter returned for points, Lines, faces, or Planes.

useFaceParameter
boolean	
Optional

For Onshape internal use.

RaycastResult type

Map containing the results of one collision between a ray and an entity.

Value	Type	Description
RaycastResult	map	
entity
Query	
A query for the entity hit by the ray.

entityType
EntityType	
The type of the entity.

parameter
Parameters for where the ray hit the entity. A unitless 2-vector for a face, a number for an edge, else undefined.

intersection
Vector	
Intersection point.

distance
ValueWithUnits	
Distance of the intersection point from the ray origin.

evRaycast (context is Context, arg is map) returns array

Detect intersections between a ray and the given entities.

Parameter	Type	Additional Info
arg	map	
entities
Query	
A query for target entities. If bodies are provided, the result will contain intersections for individual entities owned by the body.

ray
Line	
The ray to intersect the entities. Because the passed-in Line is interpreted as a ray, by default, intersections with entities "behind" the ray origin are not detected. includeIntersectionsBehind can be set to true if those intersections are desired.

EXAMPLE

line(vector(0, 0, 0) * inch, vector(1, 0, 0)) specifies the positive x-axis
closest
boolean	
Optional

Get only the closest intersection with any of the entities. Defaults to true.

includeIntersectionsBehind
boolean	
Optional

Return intersections that are behind the ray origin. Defaults to false. Cannot be set to true if closest is true.

Return type	Description
array	
An array of RaycastResults for each intersection in front of the ray, ordered from closest to farthest.

evEdgeConvexity (context is Context, arg is map) returns EdgeConvexityType

Return the convexity type of the given edge, CONVEX, CONCAVE, SMOOTH, or VARIABLE. If the edge is part of a body with inside and outside convex and concave have the obvious meanings.

Parameter	Type	Additional Info
arg	map	
edge
Query	
Throws	Additional info
GBTErrorStringEnum.TOO_MANY_ENTITIES_SELECTED	
The query evaluates to more than one entity

GBTErrorStringEnum.BAD_GEOMETRY	
The query does not evaluate to a single edge.

EdgeCurvatureResult type

The result of an evEdgeCurvature call -- a coordinate system for the Frenet frame and the curvature defined at a point

Value	Type	Description
EdgeCurvatureResult	map	
frame
CoordSystem	
The frame. The Z vector is the tangent, the X vector is the normal and the Y vector is the binormal

curvature
ValueWithUnits	
The curvature (inverse length units).

evEdgeCurvature (context is Context, arg is map) returns EdgeCurvatureResult

Return a Frenet frame along an edge, with curvature. If the curve has zero curvature at an evaluated point then the returned normal and binormal are arbitrary and only the tangent is significant.

Parameter	Type	Additional Info
arg	map	
edge
Query	
The curve to use

EXAMPLE

qNthElement(qEverything(EntityType.EDGE), 1)
parameter
number	
A number in the range 0..1 indicating the point along the curve to evaluate the frame at.

arcLengthParameterization
boolean	
Optional

If true (default), the parameter measures distance along the edge, so 0.5 is the midpoint. If false, use an arbitrary but faster-to-evaluate parameterization. The parameterization is identical to that used by evEdgeTangentLines. Results obtained with arcLengthParameterization will have lower accuracy due to approximation.

face
Query	
Optional

If present, the edge orientation used is such that walking along the edge with "up" being the face normal will keep face to the left. Must be adjacent to edge.

Throws	Additional info
GBTErrorStringEnum.NO_TANGENT_LINE	
A frame could not be calculated for the specified input.

evEdgeCurvatures (context is Context, arg is map) returns array

Return Frenet frames along an edge, with curvature. If the curve has zero curvature at an evaluated point then the returned normal and binormal are arbitrary and only the tangent is significant.

Parameter	Type	Additional Info
arg	map	
edge
Query	
The curve to use

EXAMPLE

qNthElement(qEverything(EntityType.EDGE), 1)
parameters
array	
An array of numbers in the range 0..1 indicating points along the curve to evaluate frames at.

arcLengthParameterization
boolean	
Optional

If true (default), the parameter measures distance along the edge, so 0.5 is the midpoint. If false, use an arbitrary but faster-to-evaluate parameterization. The parameterization is identical to that used by evEdgeTangentLines. Results obtained with arcLengthParameterization will have lower accuracy due to approximation.

face
Query	
Optional

If present, the edge orientation used is such that walking along the edge with "up" being the face normal will keep face to the left. Must be adjacent to edge.

Return type	Description
array	
An array of EdgeCurvatureResults.

Throws	Additional info
GBTErrorStringEnum.NO_TANGENT_LINE	
A frame could not be calculated for the specified input.

curvatureFrameTangent (curvatureResult is EdgeCurvatureResult) returns Vector

Returns the tangent vector of a curvature frame

Return type	Description
Vector	
A unit 3D vector in world space.

curvatureFrameNormal (curvatureResult is EdgeCurvatureResult) returns Vector

Returns the normal vector of a curvature frame

Return type	Description
Vector	
A unit 3D vector in world space.

curvatureFrameBinormal (curvatureResult is EdgeCurvatureResult) returns Vector

Returns the binormal vector of a curvature frame

Return type	Description
Vector	
A unit 3D vector in world space.

evEdgeTangentLine (context is Context, arg is map) returns Line

Return one tangent Line to an edge.

Parameter	Type	Additional Info
arg	map	
edge
Query	
The curve to use

EXAMPLE

qNthElement(qEverything(EntityType.EDGE), 1)
parameter
number	
A number in the range 0..1 indicating a point along the curve to evaluate the tangent at.

arcLengthParameterization
boolean	
Optional

If true (default), the parameter measures distance along the edge, so 0.5 is the midpoint. If false, use an arbitrary but faster-to-evaluate parameterization.

face
Query	
Optional

If present, the edge orientation used is such that walking along the edge with "up" being the face normal will keep face to the left. Must be adjacent to edge.

Throws	Additional info
GBTErrorStringEnum.NO_TANGENT_LINE	
A tangent line could not be evaluated for the given query.

evEdgeTangentLines (context is Context, arg is map) returns array

Return tangent lines to a edge.

Parameter	Type	Additional Info
arg	map	
edge
Query	
The curve to use

EXAMPLE

qNthElement(qEverything(EntityType.EDGE), 1)
parameters
array	
An array of numbers in the range 0..1 indicating points along the curve to evaluate tangents at.

arcLengthParameterization
boolean	
Optional

If true (default), the parameter measures distance along the edge, so 0.5 is the midpoint. If false, use an arbitrary but faster-to-evaluate parameterization.

face
Query	
Optional

If present, the edge orientation used is such that walking along the edge with "up" being the face normal will keep face to the left. Must be adjacent to edge.

Return type	Description
array	
An array of Lines.

Throws	Additional info
GBTErrorStringEnum.NO_TANGENT_LINE	
A tangent line could not be evaluated for the given query.

evEdgeCurvatureDerivative (context is Context, arg is map) returns Vector

Evaluate the derivative of the curvature vector with respect to arc length, that is, the third derivative of the curve with respect to arc length.

Parameter	Type	Additional Info
arg	map	
edge
Query	
The curve to use

EXAMPLE

qNthElement(qEverything(EntityType.EDGE), 1)
parameter
number	
A number in the range 0..1 indicating a point along the curve to evaluate the tangent at.

arcLengthParameterization
boolean	
Optional

If true (default), the parameter measures distance along the edge, so 0.5 is the midpoint. If false, use an arbitrary but faster-to-evaluate parameterization.

Throws	Additional info
GBTErrorStringEnum.NO_TANGENT_LINE	
The curvature derivative could not be evaluated for the given query.

evFacePeriodicity (context is Context, arg is map) returns array

Return the periodicity in primary and secondary direction of a face, returned in an array of booleans.

A particular direction is periodic when the face's underlying surface definition is wrapped along that direction. For instance, if primary direction is periodic, the parameters [0, v] and [1, v] will prepresent the same point for all valid v. If the secondary direction is periodic, the parameters [u, 0] and [u, 1] represent the same point for all valid u.

Parameter	Type	Additional Info
arg	map	
face
Query	
The face on which to evaluate periodicity

trimmed
boolean	
Optional

If true (default), return trimmed face periodicity instead of the underlying surface's.

FaceCurvatureResult type

The result of an evFaceCurvature call -- principal directions and curvatures at a point.

The curvature along a particular direction (in the tangent plane) is the inverse of the radius of curvature in that direction. This curvature is positive if the radius of curvature points away from the normal direction, negative if it points along the normal direction, or zero if there is no curvature in that direction. The principal curvatures at a point are the directions of minimal and maximal curvature along the surface at that point.

Value	Type	Description
FaceCurvatureResult	map	
minCurvature
ValueWithUnits	
The smaller of the two principal curvatures (inverse length units).

maxCurvature
ValueWithUnits	
The larger of the two principal curvatures (inverse length units).

minDirection
Vector	
A 3D unit vector corresponding to minCurvature.

maxDirection
Vector	
A 3D unit vector corresponding to maxCurvature.

evFaceCurvature (context is Context, arg is map) returns FaceCurvatureResult

Given a face, calculate and return principal curvatures at a point on that face, specified by its parameter-space coordinates.

EXAMPLE

 // Ellipsoid measuring 10in x 4in x 6in
fEllipsoid(context, id + "ellipsoid", {
            "center" : vector(0, 0, 0) * inch,
            "radius" : vector(5 * inch, 2 * inch, 3 * inch)
        });
const ellipseFace = qCreatedBy(id + "ellipsoid", EntityType.FACE);
const topPoint = vector(0, 0, 3) * inch; // Point on top of ellipsoid
const distanceResult = evDistance(context, { // Closest position to topPoint on ellipseFace
            "side0" : ellipseFace,
            "side1" : topPoint
        });
var uvCoordinatesAtTopPoint = distanceResult.sides[0].parameter;
var curvatureResult = evFaceCurvature(context, {
        "face" : ellipseFace,
        "parameter" : uvCoordinatesAtTopPoint
    });
//  curvatureResult is {
//      minCurvature: 3 * inch / (5 * inch)^2,
//      maxCurvature: 3 * inch / (2 * inch)^2,
//      minDirection: vector(1, 0, 0),
//      maxDirection: vector(0, 1, 0)
//  }
Parameter	Type	Additional Info
arg	map	
face
Query	
The face on which to evaluate the curvature. The face cannot be a mesh.

EXAMPLE

qNthElement(qEverything(EntityType.FACE), 1)
parameter
Vector	
a 2d unitless parameter-space vector specifying the location on the face. The coordinates are relative to the parameter-space bounding box of the face.

EXAMPLE

vector(0.5, 0.5)
evFaceCurvatures (context is Context, arg is map) returns array

Given a face, calculate and return an array of principal curvatures at points on that face, specified by its parameter-space coordinates.

Parameter	Type	Additional Info
arg	map	
face
Query	
A single face on which to evaluate the curvatures. The face cannot be a mesh.

EXAMPLE

qNthElement(qEverything(EntityType.FACE), 1)
parameters
array	
an array of 2d unitless parameter-space vectors specifying locations on the face. The coordinates are relative to the parameter-space bounding box of the face.

EXAMPLE

[ vector(0.5, 0.5), vector(0, 1) ]
Return type	Description
array	
An array of FaceCurvatureResults.

evFaceCurvatureDerivative (context is Context, arg is map) returns MatrixWithUnits

Given a face, calculate and return the derivative of the second fundamental form of the face in a given direction.

The second fundamental form is a matrix that may be computed from the principal curvatures of a surface as

const curvature = evFaceCurvature(context, { ... });
const secondFF = - curvature.minCurvature * transpose(matrix([curvature.minDirection])) * matrix([curvature.minDirection])
                 - curvature.maxCurvature * transpose(matrix([curvature.maxDirection])) * matrix([curvature.maxDirection]);
Parameter	Type	Additional Info
arg	map	
face
Query	
The face on which to evaluate the curvature. The face cannot be a mesh.

EXAMPLE

qNthElement(qEverything(EntityType.FACE), 1)
parameter
Vector	
a 2d unitless parameter-space vector specifying the location on the face. The coordinates are relative to the parameter-space bounding box of the face.

EXAMPLE

vector(0.5, 0.5)
direction
Vector	
a 3d unitless vector specifying a direction in the tangent plane of the face. It should be a unit vector perpendicular to the face's normal at the given point.

Return type	Description
MatrixWithUnits	
A 3x3 matrix with units of length ^ -2.

evFaceNormalAtEdge (context is Context, arg is map) returns Vector

Return the surface normal of a face at a position on one of its edges.

If the first result is not a face, throw an exception.

Parameter	Type	Additional Info
arg	map	
edge
Query	
face
Query	
parameter
number	
A number in the range 0..1 indicating a point along the edge to evaluate the tangent at.

arcLengthParameterization
boolean	
Optional

If true (default), the parameter measures distance along the edge, so 0.5 is the midpoint. If false, use an arbitrary but faster-to-evaluate parameterization.

usingFaceOrientation
boolean	
Optional

If true, the edge orientation used is such that walking along the edge with "up" being the face normal will keep face to the left. If false, use the default orientation of the edge, which is the same orientation used by evEdgeTangentLine. Default is false.

evFaceTangentPlaneAtEdge (context is Context, arg is map) returns Plane

Return a Plane tangent to face at a position on one of its edges.

If the first result is not a face, throw an exception.

Parameter	Type	Additional Info
arg	map	
edge
Query	
face
Query	
parameter
number	
A number in the range 0..1 indicating a point along the edge to evaluate the tangent at.

arcLengthParameterization
boolean	
Optional

If true (default), the parameter measures distance along the edge, so 0.5 is the midpoint. If false, use an arbitrary but faster-to-evaluate parameterization.

usingFaceOrientation
boolean	
Optional

If true, the edge orientation used is such that walking along the edge with "up" being the face normal will keep face to the left. If false, use the default orientation of the edge, which is the same orientation used by evEdgeTangentLine. Default is false.

evFaceTangentPlanesAtEdge (context is Context, arg is map)

Return an array of Planes tangent to a face at an array of parameters on one of its edges. The x-direction of the plane is oriented with the tangent of the edge with respect to usingFaceOrientation.

If the first result is not a face, throw an exception.

Parameter	Type	Additional Info
arg	map	
edge
Query	
face
Query	
parameters
array	
An array of numbers in the range 0..1 indicating points along the edge to evaluate the tangent at.

arcLengthParameterization
boolean	
Optional

If true (default), the parameter measures distance along the edge, so 0.5 is the midpoint. If false, use an arbitrary but faster-to-evaluate parameterization.

usingFaceOrientation
boolean	
Optional

If true, the edge orientation used is such that walking along the edge with "up" being the face normal will keep face to the left. If false, use the default orientation of the edge, which is the same orientation used by evEdgeTangentLine. Default is false.

evFaceTangentPlane (context is Context, arg is map) returns Plane

Given a face, calculate and return a Plane tangent to that face, where the plane's origin is at the point specified by its parameter-space coordinates.

Parameter	Type	Additional Info
arg	map	
face
Query	
The face to evaluate. The face cannot be a mesh.

EXAMPLE

qNthElement(qEverything(EntityType.FACE), 1)
parameter
Vector	
2d unitless parameter-space vector specifying the location of tangency on the face. The coordinates are relative to the parameter-space bounding box of the face.

EXAMPLE

vector(0.5, 0.5) places the origin at the bounding box's center.
Throws	Additional info
GBTErrorStringEnum.NO_TANGENT_PLANE	
Could not find a tangent plane or there was a problem with face parameterization.

evFaceTangentPlanes (context is Context, arg is map) returns array

Given a face, calculate and return an array of Planes tangent to that face, where each plane's origin is located at the point specified by its parameter-space coordinates.

Parameter	Type	Additional Info
arg	map	
face
Query	
The face to evaluate. The face cannot be a mesh.

EXAMPLE

qNthElement(qEverything(EntityType.FACE), 1)
parameters
array	
an array of 2d unitless parameter-space vectors specifying locations of tangency on the face. The coordinates are relative to the parameter-space bounding box of the face.

EXAMPLE

[ vector(0.5, 0.5), vector(0, 1) ]
returnUndefinedOutsideFace
boolean	
Optional

If true, the function will only return a plane if vector is on the face, otherwise returns undefined. Default is false.

Throws	Additional info
GBTErrorStringEnum.NO_TANGENT_PLANE	
Could not find a tangent plane or there was a problem with face parameterization.

evFilletRadius (context is Context, arg is map) returns ValueWithUnits

Given a face of a constant radius fillet, return the radius of fillet.

Parameter	Type	Additional Info
arg	map	
face
Query	
Throws	Additional info
GBTErrorStringEnum.BAD_GEOMETRY	
The first resolved entity was not a filleted face.

evLength (context is Context, arg is map) returns ValueWithUnits

Return the total length of all the entities (if they are edges) and edges belonging to entities (if they are bodies). If no edges are found the total length will be zero.

Parameter	Type	Additional Info
arg	map	
entities
Query	
evLine (context is Context, arg is map) returns Line

If the edge is a line, return a Line value for the given edge.

Parameter	Type	Additional Info
arg	map	
edge
Query	
Throws	Additional info
GBTErrorStringEnum.INVALID_INPUT	
The first resolved entity was not a line.

evMateConnector (context is Context, arg is map) returns CoordSystem

Gets the coordinate system of the given mate connector

Parameter	Type	Additional Info
arg	map	
mateConnector
Query	
The mate connector to evaluate.

evOwnerSketchPlane (context is Context, arg is map) returns Plane

Return the plane of the sketch that created the given entity.

Parameter	Type	Additional Info
arg	map	
entity
Query	
The sketch entity. May be a vertex, edge, face, or body.

checkAllEntities
boolean	
Optional

If true, the function will only return a plane if all entities queried under 'entity' share coplanar sketch planes. Otherwise, the plane will only be evaluated for the first entity in the query. Default is false.

Throws	Additional info
GBTErrorStringEnum.CANNOT_RESOLVE_PLANE	
Entities were not created by a sketch or do not share the same sketch plane.

evPlane (context is Context, arg is map) returns Plane

If the face is a planar face or a mate connector, return the Plane it represents.

Parameter	Type	Additional Info
arg	map	
face
Query	
Throws	Additional info
GBTErrorStringEnum.CANNOT_RESOLVE_PLANE	
The first resolved entity was not a planar face or mate connector.

evPlanarEdge (context is Context, arg is map) returns Plane

If the edge lies in a plane, return a Plane it lies in.

Parameter	Type	Additional Info
arg	map	
edge
Query	
Throws	Additional info
GBTErrorStringEnum.CANNOT_RESOLVE_PLANE	
The first resolved entity was not a planar edge.

evPlanarEdges (context is Context, arg is map) returns Plane

If all the edges in a query share the same plane, return a Plane they lie in.

Parameter	Type	Additional Info
arg	map	
edges
Query	
Throws	Additional info
GBTErrorStringEnum.CANNOT_RESOLVE_PLANE	
Edges in the query were either not planar or do not share the same plane.

evSurfaceDefinition (context is Context, arg is map) returns map

Return a descriptive value for a face, or the first face if the query finds more than one. Return a Cone, Cylinder, Plane, Sphere, Torus, or BSplineSurface as appropriate for the face, or an unspecified map value if the face is none of these with surfaceType filled of type SurfaceType

Parameter	Type	Additional Info
arg	map	
face
Query	
returnBSplinesAsOther
boolean	
Optional

If true, do not return B-spline surfaces (to avoid the associated time cost). Default is false.

Throws	Additional info
"GBTErrorStringEnum.CANNOT_RESOLVE_PLANE"	
The first result is not a face.

evApproximateBSplineSurface (context is Context, arg is map) returns map

Given a query for a face, return its approximation as a B-spline, including trim boundaries. The options forceCubic and forceNonRational may be used to restrict the type of spline that is returned for the surface, but even if these options are false, a cubic non-rational spline may be returned.

The returned representation includes a surface, the boundary loop as 2D splines in UV space, and any interior loops. The returned UV curves are typically degree 1 or 2 and non-rational. For periodic surfaces, outer and inner loops are not clearly defined and relying on them is not recommended.

Parameter	Type	Additional Info
arg	map	
face
Query	
The curve to approximate.

forceCubic
boolean	
Optional

If true, the returned surface will be a cubic spline. This does not affect the trim curves. Defaults to false.

forceNonRational
boolean	
Optional

If true, the returned surface will be non-rational. Defaults to false.

tolerance
number	
Optional

Specifies the desired approximation tolerance: the maximum distance (in meters) between the original face and the returned spline representation. Default is 1e-6, minimum is 1e-8, and maximum is 1e-4. The tolerance for trim curves is 10x the specified value.

Return	Type	Description
map	
bSplineSurface
BSplineSurface	
the underlying 3D surface

boundaryBSplineCurves
array	
array of 2D BSplineCurves representing the trimming boundary of the face. May be empty if the face is the entirety of the surface.

innerLoopBSplineCurves
array	
array of arrays of 2D BSplineCurves representing the inner loops (if any) of the trimming boundary of the face.

evTessellatedLoftMatches (context is Context, arg is map) returns map

Creates matching information for opTessellatedLoft.

The returned matches represent match regions between the two profiles.

Parameter	Type	Additional Info
arg	map	
profileSubqueries
array	
A two element array containing edge or vertex profiles to loft between.

chordalTolerance
ValueWithUnits	
The maximum distance a chord can deviate from the path. Default is 0.005 meters

connections
array	
Optional

An array of maps to define multiple profile alignments. Each connection map should contain:

(1) connectionEntities query describing an array of vertices or edges (one per profile),

(2) connectionEdges an array of individual queries for edges in connectionEntities. The order of individual edge queries should be synchronized with connectionEdgeParameters.

(3) connectionEdgeParameters array - an ordered and synchronized array of parameters on edges in connectionEdgeQueries

modelParameters
map	
Optional

frontThickness
ValueWithUnits	
The front thickness of the sheet metal.

backThickness
ValueWithUnits	
The back thickness of the sheet metal.

bendRadius
ValueWithUnits	
The bend radius of the sheet metal.

Return	Type	Description
map	
matches
array	
An array of arrays where each inner item is a map representing a point on the profile. Each inner item has a vector field position for its position in 3D space. If the point corresponds to a vertex, it will have a Query field vertex. If the point corresponds to an edge, it will have a Query field edge along with a number field parameter for the position on the edge.

isClosed
boolean	
Whether the tessellated loft is periodic.

evVertexPoint (context is Context, arg is map) returns Vector

Return the coordinates of a point, or the origin of a mate connector.

Parameter	Type	Additional Info
arg	map	
vertex
Query	
evVolume (context is Context, arg is map) returns ValueWithUnits

Return the total volume of all the entities. If no matching 3D bodies are found, the total volume will be zero.

Parameter	Type	Additional Info
arg	map	
entities
Query	
accuracy
VolumeAccuracy	
evMaxPathDeviation (context is Context, arg is map) returns map

Returns the max deviation between two paths.

Parameter	Type	Additional Info
arg	map	
side1
Query	
Bodies and/or edges forming a single continuous path.

side2
Query	
Bodies and/or edges forming a single continuous path.

showDeviation
boolean	
Optional

If true, will display a magenta comb for each deviation sample and a red line with a star for the maximum deviation. Default is false.

Return	Type	Description
map	
deviation
ValueWithUnits	
value of the max deviation between side1 and side2.

side1Point
Vector	
position on side1 where side1 is deviation away from side2.

side2Point
Vector	
position on side2 where side2 is deviation away from side1.

evPointsDeviation (context is Context, arg is map) returns array

Returns the deviation between the input points and the input topologies.

Parameter	Type	Additional Info
arg	map	
points
array	
Points to measure the deviation from.

topologies
Query	
Bodies/faces/edges/vertices to measure the deviation to. The deviation will be between each point and the closest element of topologies

allDeviations
boolean	
Optional

If true, will return a deviation value for each point in points. If false, will only return the maximum deviation. Default is false.

showDeviation
boolean	
Optional

If true, show all deviations/the max deviation depending on the value of allDeviations. Default is false.

limit
ValueWithUnits	
Optional

Do not show deviations less than this value. No effect if showDeviation is false. Default is 0 meter.

Return type	Description
array	
If allDeviations is true, an array of maps, with one map per element in points; if it is false an array of a single map. Each map has a: deviation (ValueWithUnits) : The deviation between the given point and the elements of topologies. pointPoint (Vector) : The position of the given point. topologyPoint (Vector) : The closest position in topologies.

evMeshPoints (context is Context, arg is map) returns array

Returns the positions of all the points of the input mesh bodies/faces.

Parameter	Type	Additional Info
arg	map	
meshes
Query	
Mesh faces and bodies to evaluate.

Return type	Description
array	
An array of positions of all the vertices of the given meshes

Math
approximationUtils
APPROXIMATION_SAMPLES const

Number of sample taken on the curve to perform the approximation.

MAX_CONTROL_POINTS const

Maximum number of control points to approximate the curve with.

MAX_DEGREE const

Maximum degree of the curve.

TOLERANCE_BOUND const

A LengthBoundSpec for approximation tolerance.

DEGREE_BOUND const

An IntegerBoundSpec for curve degree.

curveApproximationPredicate (definition is map) predicate

A predicate to add curve approximation parameters to a feature.

checkApproximationParameters (definition is map, path is Path)

Checks approximation options to see if the approximation would succeed and highlights the issue if not.

approximateResults (context is Context, id is Id, definition is map)

Approximates the curves created by the feature id. This meant to be used along with curveApproximationPredicate and it expects definition to have the parameters defined in the predicate.

box
This module refers to 3D bounding boxes, e.g. the result of a call to evBox3d.

This is not to be confused with the box standard type used for references.

Box3d type

A three-dimensional bounding box.

Value	Type	Description
Box3d	map	
minCorner
Vector	
A 3D position representing the corner with the smallest x, y, and z coordinates.

maxCorner
Vector	
A 3D position representing the corner with the largest x, y, and z coordinates.

canBeBox3d (value) predicate

Typecheck for Box3d

box3d (minCorner is Vector, maxCorner is Vector) returns Box3d

Construct a bounding box from two opposite corners.

box3d (pointArray is array) returns Box3d

Construct a bounding box containing all points in pointArray

transformBox3d (boxIn is Box3d, transformation is Transform) returns Box3d

Return a box aligned with transformed coordinate system containing the input box

extendBox3d (bBox is Box3d, absoluteValue is ValueWithUnits, factor is number) returns Box3d

Return an enlarged bounding box. The box is scaled by 1 + factor around its midpoint, and then each face is moved outward by absoluteValue (inward if absoluteValue is negative).

Parameter	Type	Additional Info
absoluteValue	ValueWithUnits	
The absolute distance to move each face of the box. The corners move sqrt(3) times as far.

factor	number	
The relative amount to expand the box, with 0 leaving it unchanged.

box3dCenter (bBox is Box3d) returns Vector

Return the center of the bounding box.

box3dDiagonalLength (bBox is Box3d) returns ValueWithUnits

Return the length of the diagonal from the minCorner to the maxCorner of the bounding box.

insideBox3d (point is Vector, bBox is Box3d) predicate

Whether the specified point is within the bounding box.

box3dAllCorners (bBox is Box3d) returns array

Returns all 8 corners of a Box3d as an array of Vectors.

coordSystem
WORLD_ORIGIN const

Position of the world origin, equivalent to vector(0, 0, 0) * meter

X_DIRECTION const

Direction parallel to the X axis, equivalent to vector(1, 0, 0)

Y_DIRECTION const

Direction parallel to the Y axis, equivalent to vector(0, 1, 0)

Z_DIRECTION const

Direction parallel to the Z axis, equivalent to vector(0, 0, 1)

WORLD_COORD_SYSTEM const

The world coordinate system, equivalent to coordSystem(vector(0, 0, 0) * meter, vector(1, 0, 0), vector(0, 0, 1))

CoordSystem type

A right-handed Cartesian coordinate system. Used for converting points and geometry between different reference frames, or for creating planes and mate connectors.

The y-axis of a coordinate system is not stored, but it can be obtained by calling the yAxis function, which simply performs a cross product.

See also

toWorld(CoordSystem)

fromWorld(CoordSystem)

coordSystem(Plane)

plane(CoordSystem)

opMateConnector

Value	Type	Description
CoordSystem	map	
origin
Vector	
A 3D point, in world space, representing the origin of the coordinate system.

xAxis
Vector	
A 3D unit vector, in world space, representing the x-axis of the coordinate system.

zAxis
Vector	
A 3D unit vector, in world space, representing the z-axis of the coordinate system. Must be perpendicular to the xAxis.

coordSystem (origin is Vector, xAxis is Vector, zAxis is Vector) returns CoordSystem

Creates a Cartesian coordinate system.

See also

CoordSystem

Parameter	Type	Additional Info
origin	Vector	
A 3D point in world space.

xAxis	Vector	
A 3D vector in world space. Need not be normalized.

zAxis	Vector	
A 3D vector in world space. Need not be normalized but must be orthogonal to xAxis.

tolerantEquals (cSys1 is CoordSystem, cSys2 is CoordSystem) predicate

Check that two CoordSystems are the same up to tolerance.

toWorld (cSys is CoordSystem, pointInCSys is Vector) returns Vector

Convert a specified point from a specified coordinate system into world space.

EXAMPLE

toWorld(cSys, vector(0, 0, 0)) equals cSys.origin
Parameter	Type	Additional Info
pointInCSys	Vector	
A 3D vector, measured with respect to the cSys provided.

Return type	Description
Vector	
A 3D vector in world space.

toWorld (cSys is CoordSystem) returns Transform

Returns a Transform which will transform coordinates measured in cSys into world coordinates.

EXAMPLE

toWorld(cSys) * vector(0, 0, 0) equals cSys.origin
When used in operations which place or move parts (like opTransform, opPattern, or addInstance), this transform will (somewhat counterintuitively) move parts from the world origin and orientation to the cSys origin and orientation.

fromWorld (cSys is CoordSystem, worldPoint is Vector) returns Vector

Convert a specified point from world space into a specified coordinate system.

EXAMPLE

fromWorld(cSys, cSys.origin) equals vector(0, 0, 0)
Parameter	Type	Additional Info
worldPoint	Vector	
A 3D vector, measured in world space.

Return type	Description
Vector	
A 3D vector measured in cSys

fromWorld (cSys is CoordSystem) returns Transform

Returns a Transform which will transform coordinates measured in world space into cSys coordinates.

EXAMPLE

fromWorld(cSys) * cSys.origin equals vector(0, 0, 0)
When used in operations which place or move parts (like opTransform, opPattern, or addInstance), this transform will (somewhat counterintuitively) move parts from the cSys origin and orientation to the world origin and orientation.

scaleNonuniformly (xScale is number, yScale is number, zScale is number, cSys is CoordSystem) returns Transform

Returns a Transform that represents 3 independent scalings along the X, Y, and Z axes of a particular cSys, centered around cSys.origin.

yAxis (cSys is CoordSystem) returns Vector

Returns the y-axis of a coordinate system

Return type	Description
Vector	
A 3D vector in world space.

toString (cSys is CoordSystem) returns string

Returns a representation of the coordinate system as a string.

curveGeometry
X_AXIS const

The global X axis, equivalent to line(vector(0, 0, 0) * meter, vector(1, 0, 0))

Y_AXIS const

The global Y axis, equivalent to line(vector(0, 0, 0) * meter, vector(0, 1, 0))

Z_AXIS const

The global Z axis, equivalent to line(vector(0, 0, 0) * meter, vector(0, 0, 1))

Line type

Represents a parameterized line in 3D space.

Value	Type	Description
Line	map	
origin
Vector	
A point on the line, as a 3D Vector with length units.

direction
Vector	
A unitless normalized 3D Vector.

canBeLine (value) predicate

Typecheck for Line

line (origin is Vector, direction is Vector) returns Line

Creates a line from a point and a direction.

Parameter	Type	Additional Info
direction	Vector	
The direction gets normalized by this function.

tolerantEquals (line1 is Line, line2 is Line) predicate

Check that two Lines are the same up to tolerance, including checking that they have the same origin.

To check if two Lines are equivalent (rather than equal), use collinearLines.

collinearLines (line1 is Line, line2 is Line) returns boolean

Returns true if the two lines are collinear.

transform (from is Line, to is Line) returns Transform

Returns the transformation that transforms the line from to the line to (including the origin) using the minimum rotation angle.

project (line is Line, point is Vector) returns Vector

Returns the projection of the point onto the line. See also other overloads of project.

rotationAround (line is Line, angle is ValueWithUnits) returns Transform

Returns a Transform that represents the rotation around the given line by the given angle. The rotation is counterclockwise looking against the line direction.

LineLineIntersection type

Represents an intersection between two lines. Depending on the lines, this intersection may be a point, a line, or nothing.

Value	Type	Description
LineLineIntersection	map	
dim
number	
Integer representing the dimension of the intersection.

EXAMPLE

0 indicates that intersection is a 3D length Vector.
EXAMPLE

1 indicates that intersection is a Line. (i.e. the lines are collinear)
EXAMPLE

-1 indicates that the intersection does not exist.
intersection
undefined or Vector or Line (depending on dim) that represents the intersection.

canBeLineLineIntersection (value) predicate

Typecheck for LineLineIntersection

intersection (line1 is Line, line2 is Line) returns LineLineIntersection

Returns a LineLineIntersection representing the intersection between two lines. If the lines are collinear, line1 will be stored in the intersection field of that LineLineIntersection.

isPointOnLine (point is Vector, line is Line) returns boolean

Returns true if the point lies on the line.

toString (value is Line) returns string

Circle type

Represents a circle in 3D space.

Value	Type	Description
Circle	map	
coordSystem
CoordSystem	
The circle lies in the xy plane of this coordinate system and the origin of its parameterization is the x axis.

radius
ValueWithUnits	
The radius of the circle.

canBeCircle (value) predicate

Typecheck for Circle

circle (cSys is CoordSystem, radius is ValueWithUnits) returns Circle

Returns a new Circle in the given coordinate system cSys.

circle (center is Vector, xDirection is Vector, normal is Vector, radius is ValueWithUnits) returns Circle

Returns a new Circle with the given parameters. xDirection and normal must be perpendicular.

tolerantEquals (circle1 is Circle, circle2 is Circle) predicate

Check that two Circles are the same up to tolerance, including the coordinate system.

toString (value is Circle) returns string

Ellipse type

Represents an ellipse in 3D space.

Value	Type	Description
Ellipse	map	
coordSystem
CoordSystem	
The ellipse lies in the xy plane of this coordinate system and the x axis corresponds to the major radius.

majorRadius
ValueWithUnits	
The larger of the two radii.

minorRadius
ValueWithUnits	
The smaller of the two radii.

canBeEllipse (value) predicate

Typecheck for Ellipse

ellipse (cSys is CoordSystem, majorRadius is ValueWithUnits, minorRadius is ValueWithUnits) returns Ellipse

Returns a new Ellipse with the given parameters.

ellipse (center is Vector, xDirection is Vector, normal is Vector, majorRadius is ValueWithUnits, minorRadius is ValueWithUnits) returns Ellipse

Returns a new Ellipse with the given parameters. xDirection and normal must be perpendicular.

tolerantEquals (ellipse1 is Ellipse, ellipse2 is Ellipse) predicate

Check that two Ellipses are the same up to tolerance, including the coordinate system.

toString (value is Ellipse) returns string

KnotArray type

An array of non-decreasing numbers representing the knots of a spline

canBeKnotArray (value) predicate

Typecheck for KnotArray

knotArray (value is array) returns KnotArray

Cast an array on non-decreasing numbers to a KnotArray

knotArrayIsCorrectSize (knots is KnotArray, degree is number, nControlPoints is number) predicate

Assure that size(knotArray) is 1 + degree + nControlPoints

BSplineCurve type

The definition of a spline in 3D or 2D world space, or unitless 2D parameter space.

See also

bSplineCurve(map)

Value	Type	Description
BSplineCurve	map	
degree
number	
The degree of the spline.

dimension
number	
The dimension of the spline. Must be 2 or 3.

isRational
boolean	
Whether the spline is rational.

isPeriodic
boolean	
Whether the spline is periodic.

controlPoints
array	
An array of control points of the required dimension. Size should be at least degree + 1. 2D spline control points can have world space units, or be unitless if they are intended to represent locations in parameter space (e.g. as a boundary input to opCreateBSplineSurface).

weights
array	
Required if isRational is true

An array of unitless values with the same size as the control points array.

knots
KnotArray	
An array of non-decreasing knots of size equal to 1 + degree + size(controlPoints)

canBeBSplineCurve (value) predicate

Typecheck for BSplineCurve

bSplineCurve (definition is map) returns BSplineCurve

Returns a new BSplineCurve, adding knot padding and control point overlap as necessary.

EXAMPLE

opCreateBSplineCurve(context, id + "bSplineCurve1", {
            "bSplineCurve" : bSplineCurve({
                        "degree" : 2,
                        "isPeriodic" : false,
                        "controlPoints" : [
                                vector(0, 0, 0) * inch,
                                vector(1, 0, 0) * inch,
                                vector(1, 1, 0) * inch,
                                vector(0, 1, 0) * inch],
                        "knots" : knotArray([0, .2, 1]) // Will be padded to [0, 0, 0, .2, 1, 1, 1]
                    })
        });
Creates a spline starting at the origin, moving first quickly along the x-axis (toward the second point), and finishing on the y-axis.

EXAMPLE

opCreateBSplineCurve(context, id + "bSplineCurve1", {
            "bSplineCurve" : bSplineCurve({
                        "degree" : 3,
                        "isPeriodic" : true,
                        "controlPoints" : [
                                vector(0, 0, 0) * inch,
                                vector(1, 0, 0) * inch,
                                vector(1, 1, 0) * inch,
                                vector(0, 1, 0) * inch], // Will be overlapped by repeating the first 3 points
                        "knots" : knotArray([0, .25, .5, .75, 1]) // Same as default when no knots provided. Will be padded to [-.75, -.5, -.25, 0, .25, .5, .75, 1, 1.25, 1.5, 1.75]
                    })
        });
Creates a closed, curvature-continuous, symmetric curve between the four given points.

Parameter	Type	Additional Info
definition	map	
degree
number	
The degree of the spline.

isPeriodic
boolean	
Whether the spline is periodic.

controlPoints
array	
An array of control points. See BSplineCurve for specific detail. For periodic splines, you may provide the necessary overlap, or provide control points without any overlap. If no overlap is provided, degree overlapping control points (corresponding to the first degree control points) will be added to the end of the control points list (unless you provide a set of knots that show no overlap is necessary).

EXAMPLE

[vector(-1, 1, 0) * inch, vector(1, 1, 0) * inch, vector(1, -1, 0) * inch, vector(-1, -1, 0) * inch]
weights
array	
Optional

An array of weights. See BSplineCurve for specific detail.

knots
KnotArray	
Optional

An array of knots. See BSplineCurve for specific detail. If knots are not provided a uniform parameterization wil be created such that the curve exists on the parameter range [0, 1]. For non-periodic curves with n control points, you may provide the full set of n + degree + 1 knots, or you may provide n - degree + 1 knots, and multiplicity will by padded onto the ends (which has the effect of clamping the spline to its two endpoints). For periodic curves with n unique control points (and optionally an additional degree overlapping control points), you may provide the full set of n + 2 * degree + 1 knots, or you may provide n + 1 knots, and the periodic knots will be padded onto the ends.

bSplineCurve (degree is number, isPeriodic is boolean, controlPoints is array, knots is KnotArray) returns BSplineCurve

Deprecated: Use bSplineCurve(map)

bSplineCurve (degree is number, isPeriodic is boolean, controlPoints is array, weights is array, knots is KnotArray) returns BSplineCurve

Deprecated: Use bSplineCurve(map)

math
A module containing many elementary math functions.

Some math functions (such as sin and cos) accept a ValueWithUnits, rather than a number, and are defined in the units module. There is no pow function: exponentiation is done using the ^ operator.

When writing a FeatureScript module which uses only basic math functionality, importing mathUtils (which imports this module along with matrix, transform, and vector) is recommended.

PI const

The mathematical constant pi, to floating-point precision.

EXAMPLE

myAngle = (PI / 4) * radian
In most cases, conversions using PI can be avoided if using ValueWithUnits appropriately. Thus, you should never find yourself writing a statement like sin(myAngle * PI / 180), since myAngle should already have correct units attached.

tolerantEquals (value1 is number, value2 is number) predicate

Returns true if numbers are equal up to a computational tolerance. The tolerance used is a specific number defined by TOLERANCE.computational (set to 1e-13) that is meant to adequately handle tolerances introduced by numerical operations. However, this tolerance may be too restrictive or generous for different situations, in which case tolerantEquals(number, number, number) should be used with the appropriate tolerance specified.

EXAMPLE

tolerantEquals(1, 1) returns true
EXAMPLE

tolerantEquals(1, 1 + 1e-14) returns true
EXAMPLE

tolerantEquals(1, 1 / 900 * 9e100 / 1e98) returns true
EXAMPLE

tolerantEquals(1, 1 / 9 / 9 / 9 / 9 * 9 * 9 * 9 * 9) returns true
See also

tolerantEquals(number, number, number)

tolerantEquals (value1 is number, value2 is number, tolerance is number) predicate

Returns true if numbers are equal up to a specified tolerance.

EXAMPLE

tolerantEquals(1, 1, 0) returns true
EXAMPLE

tolerantEquals(1, 1.01, 0.03) returns true
EXAMPLE

tolerantEquals(1, 0.99, 0.03) returns true
EXAMPLE

tolerantEquals(1, 1.01, 0.01) returns true
EXAMPLE

tolerantEquals(1, 1.03, 0.01) returns false
See also

tolerantEquals(number, number)

abs (value)

Absolute value.

EXAMPLE

abs(-1) returns 1
EXAMPLE

abs(-1.5 * inch) equals 1.5 * inch
sqrt (value is number)

Square root of a number.

EXAMPLE

sqrt(4) returns 2
EXAMPLE

sqrt(-4) throws an error
log (value is number)

Natural logarithm of a number.

EXAMPLE

log(exp(3)) returns 3
EXAMPLE

log(0) returns -inf
EXAMPLE

log(-1) throws an error
log10 (value is number)

Base 10 logarithm of a number.

EXAMPLE

log10(1000) returns 3
EXAMPLE

log10(0) returns -inf
EXAMPLE

log10(-1) throws an error
sinh (value is number)

Hyperbolic sine.

cosh (value is number)

Hyperbolic cosine.

tanh (value is number)

Hyperbolic tangent.

asinh (value is number)

Inverse hyperbolic sine.

acosh (value is number)

Inverse hyperbolic cosine.

atanh (value is number)

Inverse hyperbolic tangent.

exp (value is number)

e to the power of value.

EXAMPLE

exp(1) returns 2.71828...
EXAMPLE

exp(log(3)) returns 3
exp2 (value is number)

2 to the power of value.

EXAMPLE

exp2(10) returns 1024
hypot (a is number, b is number)

Hypotenuse function, as sqrt(a^2 + b^2), but without any surprising results due to finite numeric precision.

EXAMPLE

hypot(3, 4) returns 5
floor (value is number)

Round a number down to the nearest integer.

For values with units, first divide by a value with the same units.

EXAMPLE

floor(1.9) returns 1
EXAMPLE

floor(2.0) returns 2
EXAMPLE

floor(-3.3) returns -4
EXAMPLE

var numberOfBricks is number = floor(wallLength / brickLength);
ceil (value is number)

Round a number up to the nearest integer.

For values with units, first divide by a value with the same units.

EXAMPLE

ceil(1.1) returns 2
EXAMPLE

ceil(1.0) returns 1
EXAMPLE

ceil(-3.3) returns -3
EXAMPLE

var numberOfBricks is number = ceil(wallLength / brickLength)
round (value is number)

Round a number to the nearest integer.

EXAMPLE

round(1.4) returns 1
EXAMPLE

round(1.5) returns 2
EXAMPLE

round(-1.5) returns -1
roundToPrecision (value is number, precision is number)

Round a number to a given number of decimal places.

EXAMPLE

roundToPrecision(0.12345, 3) returns 0.123
EXAMPLE

roundToPrecision(9.9995, 3) returns 10
EXAMPLE

roundToPrecision(123.45, -1) returns 120
For positive values of precision, this method is more accurate than round(value, multiple). For instance, print(roundToPrecision(0.45682, 4)) prints 0.4568, but round(0.45682, 0.0001) prints 0.45680000000000004. This is because the floating point representation of 0.0001 is slightly imprecise, and that imprecision is compounded inside the call to round. The floating point value of 4, on the other hand, is precise, so the result of roundToPrecision will be the closest possible floating-point representation of 0.4568. Thus, print and other functions using string conversion (~) will not print extraneous digits.

min (value1, value2)

Return the lesser of two values, which must be comparable with <.

EXAMPLE

min(0, 1) returns 0
EXAMPLE

min(1 * meter, 1 * inch) equals 1 * inch
max (value1, value2)

Return the greater of two values, which must be comparable with <.

EXAMPLE

max(0, 1) returns 1
EXAMPLE

max(1 * meter, 1 * inch) equals 1 * meter
min (arr is array)

Return the least of an array of values, as determined by operator <, or undefined if the array is empty.

EXAMPLE

min([1, 2, 3]) returns 1
EXAMPLE

min([1 * inch, 2 * inch, 3 * inch]) equals 1 * inch
max (arr is array)

Return the greatest of an array of values, as determined by operator <, or undefined if the array is empty.

EXAMPLE

max([1, 2, 3]) returns 3
EXAMPLE

max([1 * inch, 2 * inch, 3 * inch]) equals 3 * inch
argMin (arr is array)

Return the index of the smallest element of an array, as determined by operator <, or undefined if the array is empty.

EXAMPLE

argMin([1 * inch, 2 * inch, 3 * inch]) returns 0
argMax (arr is array)

Return the index of the largest element of an array, as determined by the > operator, or undefined if the array is empty.

EXAMPLE

argMax([1 * inch, 2 * inch, 3 * inch]) returns 2
range (from is number, to is number)

Return an array of numbers in a range. Only integers are allowed.

EXAMPLE

range(0, 3) returns [0, 1, 2, 3]
range (from, to, count)

Return an array of numbers, (of type number or ValueWithUnits), in a range. Note: before FeatureScript 372 this function received as input the step size instead of the number of steps

EXAMPLE

range(0, 10, 6) returns [0, 2, 4, 6, 8, 10]
EXAMPLE

range(0, 4.5, 4) returns [0, 1.5, 3, 4.5]
EXAMPLE

range(1 * inch, 1.4 * inch, 3) returns [1 * inch, 1.2 * inch, 1.4 * inch]
clamp (value, lowerBound, higherBound)

Force a value into a range,

EXAMPLE

clamp(-1, 0, 20) returns 0,
EXAMPLE

clamp(10, 0, 20) returns 10
EXAMPLE

clamp(30, 0, 20) returns 20
EXAMPLE

clamp(30 * inch, 0 * inch, 20 * inch) equals 20 * inch
isInteger (value) predicate

True if value is a finite integer.

Note that all numbers in FeatureScript represented as floating point numbers, so an expression like isInteger(hugeInteger + 0.1) may still return true.

Used in feature preconditions to define an integer input.

isNonNegativeInteger (value) predicate

True if value is a finite integer greater than or equal to zero.

isPositiveInteger (value) predicate

True if value is a finite integer greater than zero.

mathUtils
This module imports the math, matrix, transform, and vector modules. It is designed to be imported instead of the geometry module in Feature Studios where only math (not higher-level modeling functionality) is needed.

matrix
Matrix type

A Matrix is an array of rows, all the same size, each of which is an array of numbers

canBeMatrix (val) predicate

Typecheck for Matrix

matrixSize (matrix is Matrix) returns array

Return a 2 element array containing the numbers of rows and columns of a matrix.

isSquare (matrix is Matrix) predicate

Check whether a matrix is square.

matrix (value is array) returns Matrix

Cast a two-dimensional array to a matrix.

identityMatrix (size is number) returns Matrix

Construct an identity matrix of a given dimension.

zeroMatrix (rows is number, cols is number) returns Matrix

Construct an all-zero matrix of a given dimension.

diagonalMatrix (diagonalValues is array) returns Matrix

Given an array of diagonalValues of size n, construct an nxn matrix which has those values along its main diagonal (starting in the top-left), and 0 everywhere else.

cwiseProduct (m1 is Matrix, m2 is Matrix) returns Matrix

Construct a matrix by multiplying corresponding elements of two matrices (which must be the same size).

transpose (m is Matrix) returns Matrix

Return the transpose of a matrix.

inverse (m is Matrix) returns Matrix

Compute the inverse of a matrix. Throws an exception if the matrix is not square. If the matrix is singular the resulting matrix will contain infinities.

squaredNorm (m is Matrix) returns number

Return the sum of the squares of matrix elements.

norm (m is Matrix) returns number

Return the square root of the sum of the squares of matrix elements.

svd (m is Matrix) returns map

Compute the singular value decomposition of a matrix, i.e. s, u, and v, where m == u * s * transpose(v) and s is a diagonal matrix of singular values.

Parameter	Type	Additional Info
m	Matrix	
an n-by-p matrix.

Return	Type	Description
map	
u
Matrix	
An n-by-n unitary matrix

s
Matrix	
An n-by-p diagonal matrix

v
Matrix	
A p-by-p unitary matrix

determinant (m is Matrix) returns number

Return the determinant of the matrix.

toString (value is Matrix) returns string

matrixWithUnits
MatrixWithUnits type

A MatrixWithUnits is analogous to ValueWithUnits, but wrapping a matrix.

canBeMatrixWithUnits (value) predicate

Typecheck for MatrixWithUnits

get (matrix is MatrixWithUnits, i is number, j is number) returns ValueWithUnits

Gets an element of a MatrixWithUnits, returning a ValueWithUnits.

matrixSize (matrix is MatrixWithUnits) returns array

Return a 2-element array containing the numbers of rows and columns of a matrix.

toString (value is MatrixWithUnits) returns string

nurbsUtils
removeKnots (points is array, knots is array, curveDegree is number) returns map

Remove as many knots as possible from a NURBS defined by points, knots and curveDegree.

separatePointsAndWeights (points is array) returns map

Separates a 4d array containing weighted points into a 3d unweighted points array and a 1d weights array.

combinePointsAndWeights (points is array, weights is array) returns array

Combines a 3d unweighted points array and a 1d weights array into a 4d weighted points array

persistentCoordSystem
PersistentCoordSystem type

A coordinate system that can persist as part of an attribute associated with an entity. This coordinate system will be transformed along with its parent entity as that entity undergoes transformations.

As with other attributes, the coordinate system will be propagated to copied entities, such as instances in a pattern. These copied persistent coordinate systems will take on the transforms of their new parents.

When getAttribute is used to retrieve a previously-set persistent coordinate system, the value of coordSystem will be in its transformed state for the current point in the feature execution. If a transform is applied such that the coordinate system is know longer right-handed, then the coordSystem value will be undefined. For instance, this would happen in the case of a mirrored coordinate system.

Value	Type	Description
PersistentCoordSystem	map	
coordSystem
CoordSystem	
The coordinate system to persist

coordSystemId
string	
An id to associate with the coordinate system. This id must be unique within the context of the parent entity.

forceRightHanded
boolean	
When true, ensures the coordinate system remains right-handed when mirrored by inverting the Y-axis. Otherwise, mirroring the persistent coordinate system destroys it.

persistentCoordSystem (coordSystem is CoordSystem, coordSystemId is string, forceRightHanded is boolean) returns PersistentCoordSystem

Creates a persistent coordinate system.

See also

PersistentCoordSystem

Parameter	Type	Additional Info
coordSystem	CoordSystem	
The coordinate system

coordSystemId	string	
An id with which to associate the coordinate system. This id must be unique within the context of the parent entity that an becomes associated with this persistent coordinate system through setAttribute.

forceRightHanded	boolean	
When true, ensures the coordinate system remains right-handed when mirrored by inverting the Y-axis.

splineUtils
ApproximationTarget type

A set of points and optionally derivatives to approximate by a spline.

See also

approximateSpline(Context, map)

Value	Type	Description
ApproximationTarget	map	
positions
array	
An ordered array of points for the spline to pass closely to.

startDerivative
Vector	
Required if start2ndDerivative is provided

The desired start derivative of the spline.

start2ndDerivative
Vector	
Optional

The desired start second derivative of the spline.

endDerivative
Vector	
Required if end2ndDerivative is provided

The desired end derivative of the spline.

end2ndDerivative
Vector	
Optional

The desired end second derivative of the spline.

canBeApproximationTarget (value) predicate

Typecheck for ApproximationTarget

approximationTarget (value is map) returns ApproximationTarget

Construct an ApproximationTarget

approximateSpline (context is Context, definition is map) returns array

Compute a family of splines that approximates a family of ApproximationTargets to within a given tolerance. The resulting splines are consistently parameterized, so that, for example, lofting between them will match corresponding target positions. Note: If parameters are not specified, the magnitude of start and end derivatives in targets is ignored as well as the second component parallel with the first derivative.

Parameter	Type	Additional Info
definition	map	
degree
number	
The desired degree of the curve. The output may have a different degree, if for example there aren't enough points.

tolerance
ValueWithUnits	
How far the output is allowed to deviate from the input. Must be at least 1e-8 meters.

isPeriodic
boolean	
Whether the output spline is periodic.

targets
array	
An array of ApproximationTargets. All targets must have the same number of positions and specify corresponding derivative information.

parameters
array	
Optional

An array of numbers representing the parameters corresponding to the target points. Must be strictly increasing. If specified, the output spline at those parameters will match the target points. If specified, derivatives in approximation targets will not be rescaled.

maxControlPoints
number	
Optional

The maximum number of control points that will be returned by this function's output. Tolerance will not be satisfied if this limit is reached. Default is 10000.

interpolateIndices
array	
Optional

An array of indices into target positions that specifies which ones are to be interpolated exactly. This is currently supported only for non-periodic splines.

suppressInterpolationNotice
boolean	
Optional

Don't report an info if the result is fully interpolated. Default is false.

Return type	Description
array	
An array of BSplineCurves, one for each target.

evaluateSpline (definition is map) returns array

Evaluate a 3D spline at several parameters, possibly with derivatives.

Parameter	Type	Additional Info
definition	map	
spline
BSplineCurve	
The 3D spline to evaluate.

parameters
array	
An array of numbers in the range of the spline's knot vector.

nDerivatives
number	
Optional

The number of derivatives to compute, in addition to the positions. Default is 0.

Return type	Description
array	
An array of arrays of points. If result is returned, result[i][j] is the ith derivative at jth parameter.

elevateBezierDegree (pointsIn is array, newDegree is number) returns array

Elevate the degree of a bezier curve defined by an array of control points

Parameter	Type	Additional Info
pointsIn	array	
The control points of the curve to be elevated. Must be non-empty.

newDegree	number	
The desired degree. If it is less than the number of control points, the control points will be returned unchanged.

Return type	Description
array	
The control points of the degree-elevated curve

surfaceGeometry
This module contains methods for creating and working with primitive surfaces: planes, cylinders, cones, spheres, and tori.

XY_PLANE const

The world XY plane, equivalent to plane(vector(0, 0, 0) * meter, vector(0, 0, 1), vector(1, 0, 0))

YZ_PLANE const

The world YZ plane, equivalent to plane(vector(0, 0, 0) * meter, vector(1, 0, 0), vector(0, 1, 0))

XZ_PLANE const

The world XZ plane, equivalent to plane(vector(0, 0, 0) * meter, vector(0, 1, 0), vector(0, 0, 1))

Plane type

A Plane is a data type representing an origin, a normal vector, and an X direction, perpendicular to the normal direction.

Value	Type	Description
Plane	map	
origin
Vector	
A 3D point, in world space.

normal
Vector	
A 3D unit vector in world space.

x
Vector	
A 3D unit vector in world space. Must be perpendicular to normal.

canBePlane (value) predicate

Typecheck for Plane

plane (cSys is CoordSystem) returns Plane

Create a Plane on the XY plane of a specified coordinate system.

plane (origin is Vector, normal is Vector, x is Vector) returns Plane

Create a Plane which fully specifies its orientation.

Parameter	Type	Additional Info
origin	Vector	
A 3D point in world space.

normal	Vector	
A 3D vector in world space. Need not be normalized.

x	Vector	
A 3D vector in world space. Need not be normalized.

plane (origin is Vector, normal is Vector) returns Plane

Create a Plane from a point and a normal.

The x-axis of this Plane's coordinate system will be an arbitrary vector perpendicular to the normal.

Parameter	Type	Additional Info
origin	Vector	
A 3D point in world space.

normal	Vector	
A 3D vector in world space. Need not be normalized.

alignCanonically (context is Context, plane is Plane) returns Plane

Returns the plane that would represent the coordinate system of a face coplanar with the input plane. Used in plane transformation for computing sketch patterns.

yAxis (plane is Plane) returns Vector

Returns the y-axis of the specified plane as a 3D Vector in world space.

tolerantEquals (plane1 is Plane, plane2 is Plane) predicate

Check that two Planes are the same up to tolerance, including checking that they have the same the origin and local coordinate system.

To check if two Planes are equivalent (rather than equal), use coplanarPlanes.

coplanarPlanes (plane1 is Plane, plane2 is Plane) returns boolean

Returns true if the two planes are coplanar.

planeToCSys (plane is Plane) returns CoordSystem

Create a coordinate system whose XY-plane is a specified plane, with its origin at the plane's origin.

coordSystem (plane is Plane) returns CoordSystem

Create a coordinate system whose XY-plane is a specified plane, with its origin at the plane's origin.

Alias for planeToCSys.

toString (value is Plane) returns string

project (plane is Plane, point is Vector) returns Vector

Projects a 3D point onto a Plane, returning a 3D point on the plane.

project (plane is Plane, line is Line) returns Line

Projects a Line onto a Plane, returning a Line whose origin is on the Plane and whose direction is a normalized Vector on the Plane

Throws an error if the Line is in the same direction as the normal of the Plane

planeToWorld (plane is Plane, planePoint is Vector) returns Vector

Transforms a 2D point in a Plane's coordinates to its corresponding 3D point in world coordinates.

planeToWorld3D (plane is Plane) returns Transform

Returns a Transform which takes 3D points measured with respect to a Plane (such that points which lie on the plane will have a z-coordinate of approximately 0) and transforms them into world coordinates.

worldToPlane3D (plane is Plane, worldPoint is Vector) returns Vector

Transforms a 3D point in world coordinates into a 3D point measured in a Plane's coordinates. If the point lies on the Plane, the result will have a z-coordinate of approximately 0.

worldToPlane (plane is Plane, worldPoint is Vector) returns Vector

Transforms a 3D worldPoint in world coordinates into a 2D point measured in a Plane's (x,y) coordinates.

This is modified as of FeatureScript version 363.0. Older versions of FeatureScript use worldToPlane to return 3D vectors composed of the plane coordinate system baseis. This functionality is still available in the worldToPlane function above.

worldToPlane3D (plane is Plane) returns Transform

Returns a Transform which takes 3D points measured in world coordinates and transforms them into 3D points measured in plane coordinates (such that points which lie on the plane will have a z-coordinate of approximately 0).

transform (from is Plane, to is Plane) returns Transform

Returns a Transform which maps the plane from to the plane to.

mirrorAcross (plane is Plane) returns Transform

Returns a Transform which takes points on one side of a plane and transforms them to the other side. The resulting transform is non-rigid, and using this transform in an opTransform or similar operations will invert the transformed bodies.

intersection (plane1 is Plane, plane2 is Plane)

Returns a Line at the intersection between the two Planes. If the planes are parallel or coincident, returns undefined.

LinePlaneIntersection type

Represents an intersection between a line and a plane. Depending on the line and plane, this intersection may be a point, a line, or nothing.

Value	Type	Description
LinePlaneIntersection	map	
dim
number	
Integer representing the dimension of the intersection.

EXAMPLE

0 indicates that intersection is a 3D length Vector.
EXAMPLE

1 indicates that intersection is a Line.
EXAMPLE

-1 indicates that the intersection does not exist (i.e. the line and the plane are parallel).
intersection
undefined or Vector or Line (depending on dim) that represents the intersection.

canBeLinePlaneIntersection (value) predicate

Typecheck for LinePlaneIntersection

intersection (plane is Plane, line is Line) returns LinePlaneIntersection

Returns a LinePlaneIntersection representing the intersection between line and plane.

isPointOnPlane (point is Vector, plane is Plane) returns boolean

Returns true if the point lies on the plane.

flip (plane is Plane) returns Plane

Returns a Plane with the reversed normal vector.

Cone type

Type representing a cone which extends infinitely down the positive z-axis of its coordSystem.

Value	Type	Description
Cone	map	
coordSystem
CoordSystem	
The position and orientation of the cone.

halfAngle
ValueWithUnits	
The angle from z-axis of coordSystem to the surface of the cone.

canBeCone (value) predicate

Typecheck for Cone

cone (cSys is CoordSystem, halfAngle is ValueWithUnits) returns Cone

Constructs a Cone from a coordinate system and a half angle.

tolerantEquals (cone1 is Cone, cone2 is Cone) predicate

Check that two Cones are the same up to tolerance, including the local coordinate system.

toString (value is Cone) returns string

Cylinder type

Type representing a Cylinder which extends infinitely along the z-axis of its coordSystem.

Value	Type	Description
Cylinder	map	
coordSystem
CoordSystem	
The position and orientation of the cylinder.

radius
ValueWithUnits	
The cylinder's radius.

canBeCylinder (value) predicate

Typecheck for Cylinder

cylinder (cSys is CoordSystem, radius is ValueWithUnits) returns Cylinder

Constructs a cylinder from a coordinate system and a radius.

tolerantEquals (cylinder1 is Cylinder, cylinder2 is Cylinder) predicate

Check that two Cylinders are the same up to tolerance, including the local coordinate system.

toString (value is Cylinder) returns string

Torus type

Type representing a torus, the shape of a circle revolved around a coplanar axis.

The torus represented is revolved about the z-axis of the coordSystem and centered in its xy-plane.

Value	Type	Description
Torus	map	
coordSystem
CoordSystem	
The position and orientation of the torus.

radius
ValueWithUnits	
The major radius, i.e. the distance from the center of the torus to the center of the revolved circle.

minorRadius
ValueWithUnits	
The minor radius, i.e. the radius of the revolved circle.

canBeTorus (value) predicate

Typecheck for Torus

torus (cSys is CoordSystem, minorRadius is ValueWithUnits, radius is ValueWithUnits) returns Torus

Constructs a torus from a coordinate system, the minor radius, and the major radius.

tolerantEquals (torus1 is Torus, torus2 is Torus) predicate

Check that two tori are the same up to tolerance, including the local coordinate system.

toString (value is Torus) returns string

Sphere type

Type representing a sphere of a given radius centered around a 3D point.

Value	Type	Description
Sphere	map	
coordSystem
CoordSystem	
The position and orientation of the sphere.

radius
ValueWithUnits	
The sphere's radius.

canBeSphere (value) predicate

Typecheck for Sphere

sphere (cSys is CoordSystem, radius is ValueWithUnits) returns Sphere

tolerantEquals (sphere1 is Sphere, sphere2 is Sphere) predicate

Check that two Spheres are the same up to tolerance, including the local coordinate system.

toString (value is Sphere) returns string

ControlPointMatrix type

A two-dimensional array of 3D position vectors. Reading across a row represents a change in v, and reading down a column represents a change in u.

canBeControlPointMatrix (value) predicate

Typecheck for ControlPointMatrix

controlPointMatrix (value is array) returns ControlPointMatrix

Cast a two-dimensional array of 3D position vectors to a ControlPointMatrix.

BSplineSurface type

The definition of a spline in 3D space. For all matrices of the spline definition, reading across a row represents a change in v, and reading down a column represents a change in u.

See also

bSplineSurface

Value	Type	Description
BSplineSurface	map	
uDegree
number	
The degree of the spline in u.

vDegree
number	
The degree of the spline in v.

isRational
boolean	
Whether the spline is rational.

isUPeriodic
boolean	
Whether the spline periodic in u.

isVPeriodic
boolean	
Whether the spline periodic in v.

controlPoints
ControlPointMatrix	
A grid of 3d control points. Must have at least uDegree + 1 rows and vDegree + 1 columns.

weights
Matrix	
Required if rational is true

A matrix of unitless values with the same shape as the control points grid.

uKnots
KnotArray	
An array of non-decreasing knots of size equal to 1 + uDegree + number of rows in controlPoints

vKnots
KnotArray	
An array of non-decreasing knots of size equal to 1 + vDegree + number of columns in controlPoints

canBeBSplineSurface (value) predicate

Typecheck for BSplineSurface

bSplineSurface (definition is map)

Returns a new BSplineSurface, adding knot padding and control point overlap as necessary.

EXAMPLE

opCreateBSplineSurface(context, id + "bSplineSurface1", {
            "bSplineSurface" : bSplineSurface({
                        "uDegree" : 2,
                        "vDegree" : 2,
                        "isUPeriodic" : false,
                        "isVPeriodic" : false,
                        "controlPoints" : controlPointMatrix([
                                    [vector(-2,  2, 0) * inch, vector(-1,  2, 0) * inch, vector(0,  2, 0) * inch, vector(1,  2, 0) * inch, vector(2,  2, 0) * inch],
                                    [vector(-2,  1, 0) * inch, vector(-1,  1, 0) * inch, vector(0,  1, 0) * inch, vector(1,  1, 0) * inch, vector(2,  1, 0) * inch],
                                    [vector(-2,  0, 0) * inch, vector(-1,  0, 0) * inch, vector(0,  0, 1) * inch, vector(1,  0, 0) * inch, vector(2,  0, 0) * inch],
                                    [vector(-2, -2, 0) * inch, vector(-1, -2, 0) * inch, vector(0, -2, 0) * inch, vector(1, -2, 0) * inch, vector(2, -2, 0) * inch]
                                ]),
                        "uKnots" : knotArray([0, .1, 1]), // Will be padded to [0, 0, 0, .1, 1, 1, 1]
                        "vKnots" : knotArray([0, 1/3, 2/3, 1]) // Same as default when no knots provided.  Will be padded to [0, 0, 0, 1/3, 2/3, 1, 1, 1]
                    })
        });
Creates a new spline surface on the XY plane with a protrusion at the origin, falling back to the XY plane more quickly in the +Y direction.

EXAMPLE

opCreateBSplineSurface(context, id + "bSplineSurface1", {
            "bSplineSurface" : bSplineSurface({
                        "uDegree" : 2,
                        "vDegree" : 1,
                        "isUPeriodic" : true,
                        "isVPeriodic" : false,
                        "controlPoints" : controlPointMatrix([
                                    [vector(0,  0, 1) * inch, vector(-1,  0, 0) * inch, vector(-2,  0, -1) * inch],
                                    [vector(1,  1, 1) * inch, vector( 0,  1, 0) * inch, vector(-1,  1, -1) * inch],
                                    [vector(2,  0, 1) * inch, vector( 1,  0, 0) * inch, vector( 0,  0, -1) * inch],
                                    [vector(1, -1, 1) * inch, vector( 0, -1, 0) * inch, vector(-1, -1, -1) * inch]
                                    // Will be overlapped by repeating the first two rows
                                ]),
                        "uKnots" : knotArray([0, .25, .5, .75, 1]), // Same as default when no knots provided. Will be padded to [-.5, -.25, 0, .25, .5, .75, 1, 1.25, 1.5]
                        "vKnots" : knotArray([0, .5, 1]) // Same as default when no knots provided.  Will be padded to [0, 0, .5, 1, 1]
                    })
        });
Creates a new spline surface which is a tube surrounding the origin, sheared in the X direction.

Parameter	Type	Additional Info
definition	map	
uDegree
number	
The degree of the spline in u.

vDegree
number	
The degree of the spline in v.

isUPeriodic
boolean	
Whether the spline periodic in u.

isVPeriodic
boolean	
Whether the spline periodic in v.

controlPoints
ControlPointMatrix	
A matrix of control points. See BSplineSurface for specific detail. If u or v is periodic, you may provide the necessary overlap, or provide control points without any overlap. If no overlap is provided, degree overlapping control point rows or columns (corresponding to the first degree control point rows or columns) will be added. (unless you provide a set of knots that show no overlap is necessary).

EXAMPLE

controlPointMatrix([
    [vector(-1, -1, -1) * inch, vector(-1, 0, 0) * inch, vector(-1, -2, 1) * inch],
    [vector( 0,  1, -1) * inch, vector( 0, 2, 0) * inch, vector( 0,  0, 1) * inch],
    [vector( 1, -1, -1) * inch, vector( 1, 0, 0) * inch, vector( 1, -2, 1) * inch]
])
weights
array	
Optional

A matrix of weights. See BSplineSurface for specific detail.

uKnots
KnotArray	
Optional

An array of knots. See BSplineSurface for specific detail. If knots are not provided a uniform parameterization will be created such that the u parameterization exists on the range [0, 1]. For non-periodic u with n control point rows, you may provide the full set of n + degree + 1 knots, or you may provide n - degree + 1 knots, and multiplicity will by padded onto the ends (which has the effect of clamping the surface to the control points in the first and last rows). For periodic u with n unique control points (and optionally an additional degree overlapping control points), you may provide the full set of n + 2 * degree + 1 knots, or you may provide n + 1 knots, and the periodic knots will be padded onto the ends.

vKnots
KnotArray	
Optional

See uKnots.

MeshFaceParameter type

A MeshFaceParameter is a 2D array unitless array. It is functionnally indentical to a 2D vector but because there is no guarantee of continuity for mesh parameters, it does not make sense to expose vector math for it.

canBeMeshFaceParameter (value) predicate

Typecheck for MeshFaceParameter

meshFaceParameter (value is array) returns MeshFaceParameter

Make a MeshFaceParameter from an array.

transform
Transform type

A Transform typically represents a change of position and orientation in 3D space (other affine transformations, such as scaling and shearing, can also be represented).

rotationAround, scaleUniformly, transform(Vector), toWorld(CoordSystem) and fromWorld(CoordSystem) return useful transforms. Transforms are commonly used with opTransform, whose documentation has examples of calling these functions.

Transforms are also commonly used with their * operator overloads to easily work with geometry in multiple coordinate systems.

EXAMPLE

transform * (vector(1, 1, 1) * inch) yields a point which is the given point, transformed by the transform.
EXAMPLE

transform2 * transform1 yields a new transform which is equivalent to applying transform1 followed by transform2.
A Transform contains a linear portion (rotation, scaling, or shearing), which is applied first, and a translation vector, which is applied second. Generally, these individual fields on this type don't need to be directly used, and everything you need can be accomplished through the operator overloads above, or other functions in this module and the coordSystem module.

Value	Type	Description
Transform	map	
linear
Matrix	
A linear motion, which is generally a rotation, but can also be a scaling, inversion, or shearing.

translation
Vector	
A 3D translation vector.

canBeTransform (value) predicate

Typecheck for Transform

transform (linear is Matrix, translation is Vector) returns Transform

Construct a Transform using the matrix argument for rotation and scaling and the vector argument for translation.

transform (translation is Vector) returns Transform

Construct a Transform that translates without rotation or scaling.

transform (value is map) returns Transform

identityTransform () returns Transform

Construct a transform that does nothing (no rotation, scaling, or translation).

tolerantEquals (transform1 is Transform, transform2 is Transform) predicate

Check that two Transforms are the same up to tolerance.

inverse (t is Transform) returns Transform

Compute the inverse of a Transform, such that inverse(t) * t == identityTransform().

scaleUniformly (scale is number) returns Transform

Returns a Transform that represents a uniform scaling around the origin.

scaleUniformly (scale is number, pointToScaleAbout is Vector) returns Transform

Returns a Transform that represents a uniform scaling around pointToScaleAbout.

scaleNonuniformly (xScale is number, yScale is number, zScale is number) returns Transform

Returns a Transform that represents 3 independent scalings along the X, Y, and Z axes, centered around the origin.

scaleNonuniformly (xScale is number, yScale is number, zScale is number, pointToScaleAbout is Vector) returns Transform

Returns a Transform that represents 3 independent scalings along the X, Y, and Z axes, centered around pointToScaleAbout.

transformUV
TransformUV type

A TransformUV represents a change of position and orientation in unitless 2D space.

A TransformUV contains a linear portion (rotation, scaling, or shearing), which is applied first, and a translation vector, which is applied second.

Value	Type	Description
TransformUV	map	
linear
Matrix	
A linear motion, which is generally a rotation, but can also be a scaling, inversion, or shearing.

translation
Vector	
A 2D translation vector.

isUvVector (value) predicate

True for a single 2D unitless Vector

EXAMPLE

vector(0.5, 1)
canBeTransformUV (value) predicate

Typecheck for Transform

transformUV (linear is Matrix, translation is Vector) returns TransformUV

Construct a TransformUV using the matrix argument for rotation and scaling and the vector argument for translation.

transformUV (translation is Vector) returns TransformUV

Construct a TransformUV that translates without rotation or scaling.

transformUV (value is map) returns TransformUV

identityTransformUV () returns TransformUV

Construct a transform that does nothing (no rotation, scaling, or translation).

tolerantEquals (transform1 is TransformUV, transform2 is TransformUV) predicate

Check that two TransformUVs are the same up to tolerance.

inverse (t is TransformUV) returns TransformUV

Compute the inverse of a TransformUV, such that inverse(t) * t == identityTransform().

scaleUniformlyUV (scale is number) returns TransformUV

Returns a TransformUV that represents a uniform scaling around the origin.

scaleNonuniformly (xScale is number, yScale is number) returns TransformUV

Returns a TransformUV that represents two independent scalings along the X and Y axes, centered around the origin.

rotate (angle is ValueWithUnits) returns TransformUV

Returns a TransformUV that represents a rotation around the origin with the given angle.

units
ValueWithUnits type

A ValueWithUnits is a number with dimensions, such as 1.5 inches, 90 degrees, or 9.81 meters per second per second.

const width is ValueWithUnits = 1.5 * inch;
const angle is ValueWithUnits = 90 * degree;
const g     is ValueWithUnits = 9.81 * meter / second / second;
Values with the same dimensions can be added and subtracted, even if they were created in different unit systems.

const length       = 3 * meter + 1 * inch;
const longerLength = length + 0.01 * inch;
const nonsense     = 3 * meter + 3 * degree;     // Throws an error from dimension mismatch
Multiplication (*) will multiply both the values and the units. An expression where the units all cancel evaluates to plain number.

var doubleLength   = 2 * length;                 // ValueWithUnits with length units
var area           = (20 * foot) * (30 * foot);  // ValueWithUnits with area units
var numberOfBricks = (64 * foot) / (9 * inch);   // number with no units
Values with units can be raised to numerical powers with the ^ operator. Base units like inch or second can be exponentiated in the same way.

var squareArea   = (3 * meter)^2;
var g            = 9.81 * meter / second^2;
Functions in the standard library require a ValueWithUnits for arguments where units are needed. Thus, the depth in opExtrude requires a value with length units (rather than assuming meters). The argument of sin is a value with angle units (rather than assuming radians). The argument of sqrt can be any value whose units are even powers.

var ladderHeight   = ladderLength * sin(75 * degree); // Has length units
var pendulumPeriod = 2 * PI * sqrt(armLength / g);    // Has time units
Equality of ValueWithUnits considers the underlying value, so 25.4 * millimeter is equal to 1 * inch. However, PI * radian / 5 does not equal 36 * degree because of finite precision arithmetic. To check equality of ValueWithUnits, you should use tolerantEquals.

if (tolerantEquals(myLength, 0 * inch))
{
    ...
Keeping correct units on variables is always best practice, in order to benefit from easy unit conversions and runtime unit checks. However, when printing, you may wish to divide out the units in order to display a value in a different system of units.

const length = 42 * centimeter;
println(length);                                 // prints "0.42 meter"
println("length: " ~ toString(length));          // prints "length: 0.42 meter"
println(length / inch ~ " inches");              // prints "16.535433070866137 inches"
println(roundToPrecision(length / inch, 3) ~ " inches"); // prints "16.535 inches"
unitless const

The constant 1, with no units.

meter const

A constant equal to 1 meter.

centimeter const

A constant equal to 1 centimeter.

millimeter const

A constant equal to 1 millimeter.

inch const

A constant equal to 1 inch.

foot const

A constant equal to 1 foot.

yard const

A constant equal to 1 yard.

squareMeter const

A constant equal to one square meter.

squareCentimeter const

A constant equal to one square centimeter.

squareMillimeter const

A constant equal to one square millimeter.

squareInch const

A constant equal to one square inch.

squareFoot const

A constant equal to one square foot.

squareYard const

A constant equal to one square yard.

cubicMeter const

A constant equal to one cubic meter.

cubicCentimeter const

A constant equal to one cubic centimeter.

cubicMillimeter const

A constant equal to one cubic millimeter.

cubicInch const

A constant equal to one cubic inch.

cubicFoot const

A constant equal to one cubic foot.

cubicYard const

A constant equal to one cubic yard.

radian const

A constant equal to 1 radian.

Formally, radians are unitless, so in certain situations you may need to multiply or divide by radian

EXAMPLE

var myAngle = PI / 6 * radian
EXAMPLE

var arcLength = radius * arcAngle / radian
degree const

A constant equal to 1 degree.

kilogram const

A constant equal to 1 kilogram.

gram const

A constant equal to 1 gram.

ounce const

A constant equal to 1 ounce.

pound const

A constant equal to 1 pound.

second const

A constant equal to 1 second

newton const

A constant equal to 1 newton.

kilonewton const

A constant equal to 1 kilonewton.

poundForce const

A constant equal to 1 pound-force.

pascal const

A constant equal to 1 pascal.

kilopascal const

A constant equal to 1 kilopascal.

megapascal const

A constant equal to 1 megapascal.

gigapascal const

A constant equal to 1 gigapascal.

poundPerSquareInch const

A constant equal to 1 pound per square inch.

kilopoundPerSquareInch const

A constant equal to 1 ksi.

newtonMeter const

A constant equal to 1 newton-meter.

newtonMillimeter const

A constant equal to 1 newton-millimeter.

inchPound const

A constant equal to 1 inch-pound.

footPound const

A constant equal to 1 foot-pound.

meterPerSecondSquared const

A constant equal to 1 meter per second squared.

millimeterPerSecondSquared const

A constant equal to 1 millimeter per second squared.

inchPerSecondSquared const

A constant equal to 1 inch per second squared.

footPerSecondSquared const

A constant equal to 1 foot per second squared.

radianPerSecond const

A constant equal to 1 radian per second.

degreePerSecond const

A constant equal to 1 degree per second.

revolutionsPerMinute const

A constant equal to 1 revolution per minute

joule const

A constant equal to 1 Joule.

footPoundForce const

A constant equal to 1 foot-pound force.

kilogramPerCubicMeter const

A constant equal to 1 kilogram per cubic meter

gramPerCubicCentimeter const

A constant equal to 1 gram per cubic centimeter

gramPerLiter const

A constant equal to 1 gram per liter

gramPerMilliliter const

A constant equal to 1 gram per milliliter

poundPerCubicFoot const

A constant equal to 1 pound per cubic foot

poundPerCubicInch const

A constant equal to 1 pound per cubic inch

isLength (val) predicate

True for any value with length units.

isArea (val) predicate

True for any value with area units.

isVolume (val) predicate

True for any value with volume units.

isAngle (val) predicate

True for any value with angle units.

isForce (val) predicate

True for any value with force units.

isPressure (val) predicate

True for any value with pressure units.

isMoment (val) predicate

True for any value with moment units.

isAcceleration (val) predicate

True for any value with acceleration units.

isAngularVelocity (val) predicate

True for any value with angular velocity units.

isEnergy (val) predicate

True for any value with energy units.

isDensity (val) predicate

True for any value with density units.

reciprocal (val is ValueWithUnits) returns ValueWithUnits

Inverts a value, including units.

tolerantEquals (value1 is ValueWithUnits, value2 is ValueWithUnits) predicate

Returns true if angles are equal up to zeroAngle or anything else is equal up to zeroLength

tolerantGreaterThan (greater, lesser) predicate

Returns true if greater is greater than and not tolerantly equal to lesser.

EXAMPLE

(1 * meter)->tolerantGreaterThan(0 * meter) returns true
EXAMPLE

1->tolerantGreaterThan(0) returns true
EXAMPLE

0->tolerantGreaterThan(-1e-14) returns false
EXAMPLE

0->tolerantGreaterThan(0) returns false
tolerantGreaterThanOrEqual (greater, lesser) predicate

Returns true if greater is greater than or tolerantly equal to lesser.

EXAMPLE

(1 * meter)->tolerantGreaterThanOrEqual(0 * meter) returns true
EXAMPLE

1->tolerantGreaterThanOrEqual(0) returns true
EXAMPLE

0->tolerantGreaterThanOrEqual(0) returns true
EXAMPLE

0->tolerantGreaterThanOrEqual(1e-14) returns true
tolerantGreaterThanOrEqual (greater is number, lesser is number, tolerance is number) predicate

tolerantLessThan (lesser, greater) predicate

Returns true if lesser is less than and not tolerantly equal to greater.

EXAMPLE

(0 * meter)->tolerantLessThan(1 * meter) returns true
EXAMPLE

0->tolerantLessThan(1) returns true
EXAMPLE

0->tolerantLessThan(1e-14) returns false
EXAMPLE

0->tolerantLessThan(0) returns false
tolerantLessThanOrEqual (lesser, greater) predicate

Returns true if lesser is less than or tolerantly equal to greater.

EXAMPLE

(0 * meter)->tolerantLessThanOrEqual(1 * meter) returns true
EXAMPLE

0->tolerantLessThanOrEqual(1) returns true
EXAMPLE

0->tolerantLessThanOrEqual(0) returns true
EXAMPLE

1e-14->tolerantLessThanOrEqual(0) returns true
tolerantWithinExclusive (value, lesser, greater) predicate

Returns true if value is tolerantly within the interval (lesser, greater).

EXAMPLE

(0.5 * meter)->tolerantWithinExclusive(0 * meter, 1 * meter) returns true
EXAMPLE

0.5->tolerantWithinExclusive(0, 1) returns true
EXAMPLE

1->tolerantWithinExclusive(0, 1) returns false
EXAMPLE

0->tolerantWithinExclusive(0, 1) returns false
EXAMPLE

0->tolerantWithinExclusive(1e-14, 1) returns false
tolerantWithinInclusive (value, lesser, greater) predicate

Returns true if value is tolerantly within the interval [lesser, greater].

EXAMPLE

(0.5 * meter)->tolerantWithinInclusive(0 * meter, 1 * meter) returns true
EXAMPLE

0.5->tolerantWithinInclusive(0, 1) returns true
EXAMPLE

1->tolerantWithinInclusive(0, 1) returns true
EXAMPLE

0->tolerantWithinInclusive(0, 1) returns true
EXAMPLE

0->tolerantWithinInclusive(1e-14, 1) returns true
tolerantEqualsZero (value) predicate

Returns true if value is tolerantly equal to the 0 value with the same units as value.

EXAMPLE

tolerantEqualsZero(0) returns true
EXAMPLE

tolerantEqualsZero(0 * meter) returns true
EXAMPLE

tolerantEqualsZero(1e-9 * meter) returns true
EXAMPLE

tolerantEqualsZero(1) returns false
EXAMPLE

tolerantEqualsZero(1 * meter) returns false
sqrt (value is ValueWithUnits) returns ValueWithUnits

Square root of a ValueWithUnits.

EXAMPLE

sqrt(4 * meter^2) equals 2 * meter.
EXAMPLE

2 * PI * sqrt(armLength / (9.8 * meter/second^2)) equals the period of a pendulum, in seconds.
EXAMPLE

sqrt(4 * meter) throws an error, since FeatureScript has no concept of the square root of a meter.
hypot (a is ValueWithUnits, b is ValueWithUnits)

Hypotenuse function, as sqrt(a^2 + b^2), but without any surprising results due to finite numeric precision.

EXAMPLE

hypot(3 * foot, 4 * foot) equals 5 * foot
sin (value is ValueWithUnits) returns number

Sine, the ratio of the opposite side over the hypotenuse in a right triangle of the specified angle.

EXAMPLE

sin(30 * degree) returns approximately 0.5
EXAMPLE

sin(PI * radian) returns approximately 0
cos (value is ValueWithUnits) returns number

Cosine, the ratio of the adjacent side over the hypotenuse in a right triangle of the specified angle.

EXAMPLE

cos(60 * degree) returns approximately 0.5
EXAMPLE

cos(PI * radian) returns approximately -1
tan (value is ValueWithUnits) returns number

Tangent, the ratio of the opposite side over the adjacent side in a right triangle of the specified angle.

EXAMPLE

tan(45 * degree) returns approximately 1
EXAMPLE

tan(PI * radian) returns approximately 0
asin (value is number) returns ValueWithUnits

Arcsine, i.e. inverse sine.

Returns a value between -90 * degree and 90 * degree.

EXAMPLE

asin(0.5) equals approximately 30 * degree
EXAMPLE

asin(1.5) throws an error, since there is no value where sin(value) is 1.5
acos (value is number) returns ValueWithUnits

Arccosine, i.e. inverse cosine.

Returns a value between 0 * degree and 180 * degree.

EXAMPLE

acos(0.5) equals approximately 60 * degree
EXAMPLE

acos(1.5) throws an error, since there is no value where cos(value) is 1.5
atan (value is number) returns ValueWithUnits

Arctangent, i.e. inverse tangent.

Returns a value between -90 * degree and 90 * degree.

EXAMPLE

atan(1) equals approximately 45 * degree
EXAMPLE

atan(inf) equals approximately 90 * degree
atan2 (y is number, x is number) returns ValueWithUnits

Returns the counterclockwise angle from the vector [0, 1] to the vector [x, y]. The angle is negative if y is negative. This is equivalent to atan(y/x) except the result respects the quadrant of the input and is well-behaved near x == 0.

EXAMPLE

atan2(0, 1) equals approximately 0 * degree
EXAMPLE

atan2(1, 0) equals approximately 90 * degree
EXAMPLE

atan2(0, -1) equals approximately 180 * degree
EXAMPLE

atan2(-1, 0) equals approximately -90 * degree
atan2 (y is ValueWithUnits, x is ValueWithUnits) returns ValueWithUnits

Returns the counterclockwise angle from the vector [0, 1] to the vector [x, y], assuming the units of y and x match.

See also

atan2(number, number)

isAngleBetween (queryAngle is ValueWithUnits, minAngle is ValueWithUnits, maxAngle is ValueWithUnits)

Returns true if the provided angle is within the given range (inclusive with tolerance), "winding" the query angle as necessary to put it within a positive full circle turn of the range. Ranges that encompass one or more full circles will return true regardless of the query angle.

Throws if range's maximum angle is less than the minimum angle.

EXAMPLE

isAngleBetween(0.5 * PI * radian, 0 * radian, PI * radian) returns true
EXAMPLE

isAngleBetween(0.5 * PI * radian, 2 * PI * radian, 3 * PI * radian) returns true
EXAMPLE

isAngleBetween(-1.5 * PI * radian, 0 * radian, PI * radian) returns true
floor (value, multiple)

Round a value down to nearest given multiple.

EXAMPLE

floor(125, 10) returns 120
EXAMPLE

floor(-15, 10) returns -20
EXAMPLE

floor(3.14 * inch, 0.1 * inch) equals 3.1 * inch
ceil (value, multiple)

Round a value up to nearest given multiple.

EXAMPLE

ceil(125, 10) returns 130
EXAMPLE

ceil(-15, 10) returns -10
EXAMPLE

ceil(3.14 * inch, 0.1 * inch) equals 3.2 * inch
round (value, multiple)

Round a value to nearest given multiple.

EXAMPLE

round(125, 10) returns 130
EXAMPLE

round(-15, 10) returns -10
EXAMPLE

round((10 / 3) * meter, centimeter) equals 3.33 * meter
EXAMPLE

round(1 * meter, .001 * inch) equals 39.37 * inch
For small values of multiple, roundToPrecision is preferred to reduce floating point errors.

toString (value is ValueWithUnits) returns string

General value to string conversion.

parseJsonWithUnits (s is string)

Parse a JSON string into either a map or array. Null values in the JSON are returned as undefined. Throws if the string is not well-formed JSON. Applicable strings are parsed into a ValueWithUnits. For instance, "3 inch" will map to a ValueWithUnits with length units that repreresents 3 inches.

Return type	Description
A map or an array corresponding to the JSON value.

vector
Vector type

A Vector is a non-empty array. It should contain numbers or lengths.

Operators +, -, *, and / are overloaded for vectors, and other operations such as dot product are available. If a vector does not contain numbers or lengths, operations that assume number-like properties may fail.

canBeVector (value) predicate

Typecheck for Vector

vector (value is array) returns Vector

Make a Vector from an array.

vector (x, y) returns Vector

Construct a 2-dimensional vector.

vector (x, y, z) returns Vector

Construct a 3-dimensional vector.

isLengthVector (value) predicate

True for a Vector where all members are values with length units.

EXAMPLE

vector([1, 2, 3, 4, 5]) * inch
isUnitlessVector (value) predicate

True for a Vector where all members are simple numbers.

EXAMPLE

vector([1, 2, 3, 4, 5])
is2dPoint (value) predicate

True for a single 2D length Vector

EXAMPLE

vector(0.5, 1) * inch
is2dPointVector (value) predicate

True for an array where all members are 2D lengths.

EXAMPLE

[vector(0, 0) * inch, vector(0, 1) * inch, vector(1, 0) * inch]
is2dDirection (value) predicate

True for a unitless 2D Vector that is normalized (i.e. has length 1)

EXAMPLE

vector(0, 1)
is3dLengthVector (value) predicate

True for a 3D Vector where all members are values with length units.

EXAMPLE

vector(0, 1.5, 30) * inch
is3dDirection (value) predicate

True for a unitless 3D Vector that is normalized (i.e. has length 1)

EXAMPLE

vector(0, 0, 1)
zeroVector (size is number) returns Vector

Make an array filled with 0.

EXAMPLE

zeroVector(3) is equivalent to vector(0, 0, 0)
squaredNorm (vector is Vector)

Returns the squared length of a vector. This is slightly faster to calculate than the length.

norm (vector is Vector)

Returns the length (norm) of a vector.

dot (vector1 is Vector, vector2 is Vector)

Returns the dot product of two vectors.

cross (vector1 is Vector, vector2 is Vector) returns Vector

Returns the cross product of two 3-dimensional vectors.

angleBetween (vector1 is Vector, vector2 is Vector) returns ValueWithUnits

Returns the angle between two 3-dimensional vectors. Values are within the range [0, PI] * radian.

EXAMPLE

angleBetween(X_DIRECTION, Y_DIRECTION) equals PI/2 * radian
EXAMPLE

angleBetween(Y_DIRECTION, X_DIRECTION) equals PI/2 * radian
A plane is fitted to the two vectors and the shortest angle between them is measured on that plane.

angleBetween (vector1 is Vector, vector2 is Vector, ref is Vector) returns ValueWithUnits

Returns the counterclockwise angle between two 3-dimensional vectors as witnessed from the tip of a third 3-dimensional vector. Values are within the range (-PI, PI] * radian with negative values indicating clockwise angles.

EXAMPLE

angleBetween(X_DIRECTION, Y_DIRECTION, Z_DIRECTION) equals PI/2 * radian
EXAMPLE

angleBetween(Y_DIRECTION, X_DIRECTION, Z_DIRECTION) equals -PI/2 * radian
The first two vectors are projected onto a plane perpendicular to the reference vector and the angle is measured according to that projection.

normalize (vector is Vector) returns Vector

Returns the (unitless) result of normalizing vector. Throws if the input is zero-length.

Parameter	Type	Additional Info
vector	Vector	
A Vector with any units.

project (target is Vector, source is Vector) returns Vector

Project the source vector onto the target vector. Equivalent to target * dot(source, target) / squaredNorm(target).

perpendicularVector (vec is Vector) returns Vector

Returns a vector perpendicular to the given vector. The choice of which perpendicular vector to return is arbitrary but consistent for the same input. The returned vector is unitless and of length 1.

rotationMatrix3d (from is Vector, to is Vector) returns Matrix

Construct a 3D rotation matrix that represents the minimum rotation that takes the normalized from vector to the normalized to vector. The inputs may have any units.

rotationMatrix3d (axis is Vector, angle is ValueWithUnits) returns Matrix

Construct a 3D matrix representing a counterclockwise (looking against the axis) rotation around the given axis by the given rotation angle.

scalarTripleProduct (vector1 is Vector, vector2 is Vector, vector3 is Vector)

Returns the scalar triple product, a dot (b cross c), of three 3-dimensional vectors.

toString (value is Vector) returns string

tolerantEquals (point1 is Vector, point2 is Vector) predicate

Returns true if two vectors designate the same point (within tolerance) or the same direction (within tolerance).

parallelVectors (vector1 is Vector, vector2 is Vector) returns boolean

Returns true if two vectors are parallel (within tolerance).

perpendicularVectors (vector1 is Vector, vector2 is Vector) returns boolean

Returns true if two vectors are perpendicular (within tolerance).

clusterPoints (points is array, tolerance is ValueWithUnits) returns array

Groups points into clusters. Two points farther than tolerance apart are guaranteed to be in separate clusters. A set of points all within tolerance of each other that has no other points within tolerance is guaranteed to be a single cluster.

Return type	Description
array	
Array of arrays, where each array is a cluster of nearby points, represented as indices into points array.

Utilities
attributes
Attributes are data attached to individual entities, which can be set and retrieved by name in FeatureScript. The data can be of any type, and multiple attributes with different names can be associated with the same topological entity.

One common use case for attributes is to set attributes on an entity in one feature, and get them in another. For data not associated with entities, the same thing can be accomplished simply via setVariable and getVariable, but attributes allow that data to be set on specific bodies, faces, edges, or vertices.

setAttribute(context, {
   "entities" : somePart,
   "name" : "refPoint",
   "attribute" : vector(0, 0, 1) * inch
});
// Later, possibly in another feature:
const partRefPoint = getAttribute(context, {
   "entity" : somePart,
   "name" : "refPoint"
});
if (partRefPoint != undefined)
{
    // use partRefPoint...
}
Attributes are also a useful way to mark important groups of entities for other features or other deriving Part Studios. You can query for entities with a specific attribute, a specific attribute value, or a value matching a given pattern with the query functions qHasAttribute, qHasAttributeWithValue, or qHasAttributeWithValueMatching, respectively.

Attributes stay with the entity they are defined on, even as the Part Studio changes. An attribute on a face, edge, or body which is split in two will be set with the same name and value on both split pieces. An attribute on a patterned entity will be set on each patterned copy. If two or more entities are merged together (e.g. with a boolean union), then the attributes on both are kept on the result, though if they have attributes with the same name, the value of the primary entity (e.g. the first resolved body in the boolean tools) will be used.

Legacy unnamed attributes: A previous use of these attribute functions involved setting unnamed attributes by calling setAttribute without a "name". This workflow is still supported, but is no longer recommended. Legacy unnamed attributes can be identified and retrieved only by type, and two attributes of the same type are not allowed on the same entity. The behavior of these unnamed attributes, described in "Legacy unnamed attribute" notes like this one, can be safely ignored if all your attributes are set with a "name".

setAttribute (context is Context, definition is map)

Attach an attribute to one or several entities. Will overwrite any attribute previously set on the same entity with the same name.

Parameter	Type	Additional Info
definition	map	
entities
Query	
Entities to attach attribute to. Throws an error if the query resolves to nothing.

name
string	
The name of the attribute

attribute
The data to set. Can be any type. If undefined is provided, any existing attribute will be unset (and this entity will no longer resolve in qHasAttribute and similar functions)

Legacy unnamed attributes: If name is not provided, adds an unnamed attribute to the entities. If more than one unnamed attribute with the same type is set on any entity, throws an error.

getAttributes (context is Context, definition is map) returns array

Get attributes attached to entities.

Parameter	Type	Additional Info
definition	map	
entities
Query	
Entities to get attributes on. If query resolves to nothing, empty array is returned

name
string	
The name of the attribute to get.

attributePattern
Optional

Providing a map here will also filter out attributes which do not have entries precisely matching the keys and values of attributePattern, similar to qHasAttributeWithValueMatching.

EXAMPLE

{ "odd" : true } matches all attributes values are maps with a field "odd" whose value is true.
Legacy unnamed attributes: If attributePattern is provided and name is not, getAttributes will only return unnamed attributes with the same type as attributePattern, using the same behavior documented in the legacy function qAttributeFilter.

Return type	Description
array	
An array of all unique attributes on the given entities matching the pattern.

getAttribute (context is Context, definition is map)

Get the value of a single named attribute attached to a single entity, or undefined if no attribute of that name has been set.

EXAMPLE

setAttribute(context, { "entities" : someEntities, "name" : "importantData", "attribute" : 42});
for (const entity in evaluateQuery(entities)) {
    const value = getAttribute(context, {
        "entity" : entity,
        "name" : "importantData"
    });
    println(value); // prints 42
}
Parameter	Type	Additional Info
definition	map	
entity
Query	
Query resolving to a single entity to get the attribute from. If multiple entities are resolved, the first resolved entity is considered.

name
string	
Name of the attribute

getAllAttributes (context is Context, definition is map) returns map

Get the named attributes attached to a single entity, or an empty map if the entity has no attributes.

Parameter	Type	Additional Info
definition	map	
entity
Query	
Query resolving to a single entity to get the attributes from.

Return type	Description
map	
A map from attribute names to attribute values for all of the attributes on the given entity.

removeAttributes (context is Context, definition is map)

Has no effect on named attributes, instead use setAttribute with "attribute" : undefined.

Legacy unnamed attributes: Remove matching unnamed attributes attached to entities.

Parameter	Type	Additional Info
definition	map	
entities
Query	
Optional

Entities to remove unnamed attributes from. Default is everything.

attributePattern
Optional

If provided, will only remove attributes with the same type, using the same behavior documented in the legacy function qAttributeFilter.

computedPartProperty
defineComputedPartProperty (propertyFunction is function) returns function

This function takes a computed part property function and wraps it to define a computed part property. It is analogous to defineFeature, except that it is used to define computed part properties. A typical usage is something like:

annotation { "Property Function Name" : "MyProperty" }  // annotation required for Onshape to recognize computed property function
export const myProperty = defineComputedPartProperty(function(context is Context, part is Query, definition is map)
    returns ValueWithUnits // may also return string or boolean or number
    // definition is an empty map and reserved for future use
    {
        ... // Compute and return the property value, using the context and the parameters
    });
For more information on writing computed part properties, see Computed part properties in the FeatureScript guide.

Parameter	Type	Additional Info
propertyFunction	function	
A function that takes a context, a part Query that returns a single Part, and a definition, and that returns a value such as a number or a string or a ValueWithUnits.

containers
This module contains functions for working with FeatureScript arrays (e.g. [1, 2, 3]) and maps (e.g. { "x" : 1, "y" : true })

makeArray (size is number, fillValue) returns array

Create a new array with given size, filled with fillValue. Note: this is equivalent to assigning each individual array element to fillValue; boxes and builtins will not be deep-copied.

EXAMPLE

makeArray(3, 0) returns [0, 0, 0]
makeArray (size is number) returns array

Create a new array with given size, filled with undefined.

EXAMPLE

makeArray(3) returns [undefined, undefined, undefined]
size (container is array) returns number

Returns the size of an array. This counts only direct children; it does not recursively examine containers inside.

EXAMPLE

size([1, 2, 3]) returns 3
EXAMPLE

size([1, [2, 3]]) returns 2
size (container is map) returns number

Returns the size of an map. This counts only direct children; it does not recursively examine containers inside.

EXAMPLE

size({ "x" : 1, "y" : 2 }) returns 2
isIn (value, container is array) returns boolean

Returns true if value appears in an array, using == for comparison.

EXAMPLE

isIn(1 * inch, [0 * inch, 1 * inch, 2 * inch]) returns true
indexOf (container is array, value) returns number

Return the index of the value in container, or -1 if the value is not found.

indexOf (container is array, value, startIndex is number) returns number

Return the index of the value in container starting the search at a specified start index, or -1 if the value is not found.

isValueIn (value, container is map) returns boolean

Returns true if value appears as the value of a map entry, using == for comparison.

EXAMPLE

isValueIn(true, { "a" : true, "b" : 0 }) returns true
EXAMPLE

isValueIn("b", { "a" : true, "b" : 0 }) returns false
mapArray (arr is array, mapFunction is function) returns array

Returns a new array, with the same size as arr, created by mapping each element of arr through a mapFunction.

EXAMPLE

mapArray([0, 1], function(x) { return -x; }) returns [0, -1]
Parameter	Type	Additional Info
mapFunction	function	
A function which takes in one argument (a member of the input array) and returns a value.

resize (arr is array, newSize is number, newValue) returns array

Returns a copy of an array with size changed to newSize. If the new size is larger than the original size, the extra values are set to newValue.

EXAMPLE

resize([1, 2, 3], 2, 0) returns [1, 2]
EXAMPLE

resize([1, 2, 3], 5, 0) returns [1, 2, 3, 0, 0]
resize (arr is array, newSize is number) returns array

Returns a copy of an array with size changed to newSize. If the new size is larger than the original size, the extra values are set to undefined.

append (arr is array, newValue) returns array

Returns a copy of an array with a single value added to the end.

EXAMPLE

append([1, 2], 3) returns [1, 2, 3]
concatenateArrays (arr is array) returns array

Given an array of arrays, concatenate the contents of the inner arrays.

EXAMPLE

concatenateArrays([[1, 2], [3, 4]]) returns [1, 2, 3, 4]
EXAMPLE

concatenateArrays([[1], [], [2, undefined], [[3]]]) returns [1, 2, undefined, [3]]
concatenateArrays (a is array, b is array) returns array

Given two arrays, concatenate the contents of the arrays.

EXAMPLE

concatenateArrays([1, 2], [3, 4]) returns [1, 2, 3, 4]
mergeMaps (defaults is map, m is map) returns map

Add each key-value pair in the second map to a copy of first and return the result. Since later-added entries take precedence, nothing from the second map will be lost.

In other words, any keys from defaults which are missing from m will be filled in with their values from defaults.

EXAMPLE

mergeMaps({a:0}, {a:1}) returns {a:1}
EXAMPLE

mergeMaps({a:0}, {b:1}) returns {a:0, b:1}
intersectMaps (maps is array) returns map

Compute the intersection of the keysets of the input maps. In other words, returns a map whose keys are present in all input maps and whose values are taken from the last map.

EXAMPLE

intersectMaps([{a:0}, {a:1}]) returns {a:1}
EXAMPLE

intersectMaps([{a:0}, {b:1}]) returns {}
EXAMPLE

intersectMaps([{a:0, b:1}, {a:0, b:2}]) returns {a:0, b:2}
reverse (arr is array) returns array

Return a copy of an array with elements in reverse order.

EXAMPLE

reverse([1, 2, 3]) returns [3, 2, 1]
sort (entities is array, compareFunction is function)

Return a sorted copy of an array. Current implementation uses merge sort.

EXAMPLE

sort([3, 1, 2], function(a, b) { return a - b; }) returns [1, 2, 3]
Parameter	Type	Additional Info
compareFunction	function	
A function that takes two values, returns a negative value if the first is before the second, 0 if the two are equal, and positive value if the second is before the first.

tolerantSort (values is array, tolerance) returns array

Returns a sorted copy of values, where any sequence of values within tolerance of each other is sorted in the order of the original array.

This is useful when sorting by a geometric measurement (like length, area, or volume) because it makes it much less likely that a tiny change in that computed value will change the resulting sort order.

EXAMPLE

tolerantSort([5, 1.000001, 1, 8], 0.001) returns [1.000001, 1, 5, 8]
EXAMPLE

tolerantSort( [1 * inch, 1.00009 * inch, 0.99991 * inch], 0.0001 * inch) returns [1 * inch, 1.00009 * inch, 0.99991 * inch]. The order is entirely unchanged since two pairs of values are within the tolerance (even though the third pair isn't).
Parameter	Type	Additional Info
values	array	
An array of number or ValueWithUnits.

tolerance		
Tolerance for comparing elements of values.

tolerantSort (entities is array, tolerance, mapFunction) returns array

Performs a tolerantSort of entities, ordering by the value returned by mapFunction. Like tolerantSort, the original order will be preserved for values within tolerance for stability.

Parameter	Type	Additional Info
tolerance		
EXAMPLE

1e-7 * meter
mapFunction		
A function taking in a single entity and returning a sortable number or ValueWithUnits.

EXAMPLE

function(entity is Query) { return evLength(context, {"entities" : entity}); } to sort entities by increasing length.
filter (arr is array, filterFunction is function)

Return the members of an array matching a predicate function, preserving element order.

Throws exception if filterFunction throws, or if the filterFunction does not return boolean.

EXAMPLE

filter([1, 2, 3, 4, 5, 6], function(x) { return x % 2 == 0; }) returns [2, 4, 6]
Parameter	Type	Additional Info
filterFunction	function	
A function which takes one argument (a member of the input array) and returns a boolean.

first (m is map)

Return the first item in a map

keys (container is map) returns array

Returns the keys in the supplied map in map iteration order.

EXAMPLE

keys({ "a" : 1, "c" : 2, "b" : 3 }) returns ["a", "b", "c"]
values (container is map) returns array

Returns the values in the supplied map ordered by the map iteration ordering of their associated keys.

EXAMPLE

values({ "a" : 1, "c" : 2, "b" : 3 }) returns [1, 3, 2]
subArray (input is array, startIndex is number) returns array

Returns the subarray beginning at startIndex

subArray (input is array, startIndex is number, endIndex is number) returns array

Returns the subarray [startIndex, endIndex)

insertIntoMapOfArrays (mapToInsertInto is map, key, value) returns map

Inserts value into the array keyed by key, returns the updated map

last (elements is array)

Returns last element of array.

rotateArray (elements is array, step is number) returns array

Returns a rotated array of the same elements. step less than zero moves elements towards the front. step greater than zero moves elements towards the back.

EXAMPLE

rotateArray([0, 1, 2], -1) returns [1, 2, 0]
insertElementAt (arr is array, index is number, value) returns array

Returns an array with value inserted at index.

removeElementAt (arr is array, index is number) returns array

Returns an array with the element at index removed.

all (arr is array, checkFunction is function) returns boolean

Returns true if and only if all elements of an array, when passed into the checkFunction, return true.

EXAMPLE

all([0, 2, 4], function(e){ return e % 2 == 0; }) returns true
EXAMPLE

all([], function(e){ return false; }) returns true
See also

all(array)

Parameter	Type	Additional Info
arr	array	
An array of elements to be checked.

checkFunction	function	
A unary function that returns a boolean.

Return type	Description
boolean	
true if and only if all checkFunction(element) calls return true.

all (arr is array) returns boolean

Returns true if all elements in the passed array are true.

EXAMPLE

all([]) returns true
EXAMPLE

all([false, false, true]) returns false
EXAMPLE

all([true, true, true]) returns true
See also

all(array, function)

Parameter	Type	Additional Info
arr	array	
An array of booleans.

Return type	Description
boolean	
true if and only if all elements are true.

allCombinations (arr is array) returns array

Creates all possible combinations from arrays of values for each element.

EXAMPLE

allCombinations([[1,2], [3,4]]) returns [[1,3], [1,4], [2,3], [2,4]]
EXAMPLE

allCombinations([[0, 1, 2, 3]]) returns [[0], [1], [2], [3]]
EXAMPLE

allCombinations([[], [0, 1, 2]]) returns []
Parameter	Type	Additional Info
arr	array	
An array of arrays, where each array represents all possible values for the given array's index in the returned arrays.

Return type	Description
array	
An array of all possible combinations that have exactly one element from each of the input arrays.

any (arr is array, check is function) returns boolean

Returns true if any element of an array, when passed into the check function, returns true.

EXAMPLE

any([1, 3, 4], function(e){ return e % 2 == 0; }) returns true
EXAMPLE

any([], function(e){ return true; }) returns false
See also

any(array)

Parameter	Type	Additional Info
arr	array	
An array of elements.

Return type	Description
boolean	
true if and only if at least one check(element) call returns true.

any (arr is array) returns boolean

Returns true if any element in the passed array is true.

EXAMPLE

any([]) returns false
EXAMPLE

any([false, false, true]) returns true
See also

any(array, function)

Parameter	Type	Additional Info
arr	array	
An array of booleans.

Return type	Description
boolean	
true if and only if at least one element is true.

average (arr is array)

Returns the average of an array. All array elements must be mutually addable and divisible by a number.

EXAMPLE

average([1, 2, 3, 4]) returns 2.5
EXAMPLE

average([vector([1, 0, 0])*meter, vector([0, 0, 0])*meter, vector([0, 1, 0])*meter]) returns vector(1/3, 1/3, 0) * meter
Parameter	Type	Additional Info
arr	array	
An array of mutually addable and divisible elements.

Return type	Description
The average of values in the passed in array.

deduplicate (arr is array) returns array

Deduplicate an array. Maintains original array order, eliminating all but the first occurrence of a given duplicate.

EXAMPLE

deduplicate([1, 2, 1, 3, 2, 0, 0]) returns [1, 2, 3, 0]
EXAMPLE

deduplicate([]) returns []
Parameter	Type	Additional Info
arr	array	
An array of values to be deduplicated.

Return type	Description
array	
An array of deduplicated values.

foldArray (arr is array, seed, foldFunction is function)

Folds an array from left to right with a foldFunction.

EXAMPLE

foldArray([1, 2, 3], 0, function(accumulator, element) { return accumulator + element; }) returns 6
Parameter	Type	Additional Info
arr	array	
An array to fold.

seed		
The initial value of the accumulator to be passed into the foldFunction.

foldFunction	function	
A binary function which takes in an accumulator (the seed for the first iteration, and the result of the previous call for subsequent iterations) and an element of the passed in array.

Return type	Description
The accumulator after all elements of arr have been folded.

foldArray (arr is array, foldFunction is function)

Calls foldArray with the seed set to the first element of arr.

See also

foldArray

mapArrayIndices (arr is array, mapIndexFunction is function) returns array

Returns a new array, with the same size as arr, created by mapping each index of arr through a mapIndexFunction.

EXAMPLE

const myArray = [1, 3, 5]; mapArrayIndices(myArray, function(i) { return myArray[i] + myArray[ (i+1) % size(myArray)]; }) returns [4, 8, 6]
Parameter	Type	Additional Info
mapIndexFunction	function	
A function which takes in one argument (an index of the input array) and returns a value.

Return type	Description
array	
The results of calling mapIndexFunction on the indices of all elements in the passed in arr.

mapValue (value, mapFunction is function)

Map a value using a mapFunction and return the result. Particularly useful when using a lambda function inline to dynamically change some value.

EXAMPLE

mapValue(4, function(n){ return n+1; }) returns 5
EXAMPLE

couldBeUndefined->mapValue(function(v){ return v == undefined ? 'a great default' : v; })
Parameter	Type	Additional Info
value		
Anything that the passed in mapFunction will accept as a parameter.

mapFunction	function	
A function that will be called on the passed in value.

Return type	Description
The result of calling mapFunction with value.

memoizeFunction (f is function) returns function

Memoize a unary (one-parameter) function. Once memoized, if the returned function is called with the same parameter twice, the second return value will be fetched from an internal cache. This can dramatically speed up calculations - particularly when f is called with the same parameter many times. The overhead of memoizing a function is negligible. Note that memoization will not properly work with functions that have side effects, such as modifying a box.

EXAMPLE

const square = memoizeFunction(function(n){ return n^2; });
println(square(5)); // calls f internally and prints 25
println(square(5)); // retrieves cached value of 25 and returns it
Parameter	Type	Additional Info
f	function	
A unary function to be memoized.

Return type	Description
function	
A memoized function that will return the same thing as f.

mergeMaps (defaults, keyList is array, newNode)

Merge maps at a particular location as specified by the keyList. If either the destination node specified by the keyList or the newNode is not a map, the newNode will replace the destination node.

EXAMPLE

mergeMaps({ a: [ { b: 2 } ] }, ['a', 0, 'b'], 4) returns { a : [ { b : 4 } ] }
EXAMPLE

mergeMaps(5, [], 4) returns 4
EXAMPLE

mergeMaps({ a : 5 }, ['a'], 4) returns {a: 4 }
See also

mergeMaps(map, map)

Parameter	Type	Additional Info
defaults		
A container (array or map) that will be merged at the location specified by the keyList. If defaults is not an array or map and keyList is empty, the result is newNode since a merge isn't possible.

keyList	array	
An array of map keys or array indices that collectively specify a location within defaults to perform the merge.

newNode		
A value that will be merged into defaults at the location specified by keyList. If the newNode specified is a map and the node identified by keyList is a map, then this will perform a mergeMaps operation.

Return type	Description
The merged or replaced value.

sum (arr is array)

Sum an array of elements that are all mutually addable. An empty array returns 0.

EXAMPLE

sum(range(0,5)) returns 15
EXAMPLE

sum([vector(1, 2, 3) * meter, vector(4, 5, 6) * meter]) returns vector(5, 7, 9) * meter
EXAMPLE

sum([]) returns 0
Parameter	Type	Additional Info
arr	array	
An array of mutually addable elements to be summed.

Return type	Description
The sum of values in the passed in array.

zip (arr is array) returns array

Makes an array that aggregates elements from each of the arrays. Returns an array of arrays, where the i-th array contains the i-th element from each of the argument arrays. The array stops when the shortest input array is exhausted. With a single array argument, it returns an array of single element arrays. With no arguments, it returns an empty array.

EXAMPLE

zip([range(0,3), range(10,13), range(20,26)]) returns [[0, 10, 20], [1, 11, 21], [2, 12, 22], [3, 13, 23]]
EXAMPLE

zip([]) returns []
EXAMPLE

zip([range(0, 3)]) returns [[0],[1],[2],[3]]
See also

zip(array, array)

Parameter	Type	Additional Info
arr	array	
An array of arrays to aggregate.

Return type	Description
array	
An array where the i'th element contains the i'th element from each of the passed in arrays.

zip (a is array, b is array) returns array

An alternative way to call zip(array) that facilitates chaining arguments.

EXAMPLE

zip(range(0,3), range(1, 4)) returns [[0, 1], [1, 2], [2, 3], [3, 4]]
EXAMPLE

zip(range(0,3), []) returns []
See also

zip(array)

Parameter	Type	Additional Info
a	array	
The first array to zip.

b	array	
The second array to zip.

Return type	Description
array	
An array of length-2 arrays. For the i'th array, the first element is the i'th element of a and the second is the i'th element of b.

cosmeticThreadUtils
CosmeticThreadData type

Data required to properly render cosmetic threads onto tapped surfaces.

Value	Type	Description
CosmeticThreadData	map	
threadOriginCoordSys
PersistentCoordSystem	
A coordinate system representing the origin of a thread. For external threads, this represents the center of the circular edge selected for the thread. For tapped holes, it represents the vertex selected to create the hole.

threadPitch
number	
Pitch of the thread per the selected ANSI or ISO standard.

tappedDepth
number	
Distance from the thread origin to the thread's termination.

addCosmeticThreadAttribute (context is Context, entities is Query, cosmeticThreadData is CosmeticThreadData)

Applies a cosmetic thread attribute to the specified entities.

See also

CosmeticThreadData

Parameter	Type	Additional Info
context	Context	
The application context.

entities	Query	
A query for entities to requiring thread data.

cosmeticThreadData	CosmeticThreadData	
Data required to properly render tapped threads on faces.

createCosmeticThreadDataFromEntity (threadCoordSys is CoordSystem, tappedDepth is number, threadPitch is number) returns CosmeticThreadData

Creates a cosmetic thread data attribute to be applied to face entities using addCosmeticThreadAttribute.

See also

CosmeticThreadData

Parameter	Type	Additional Info
threadCoordSys	CoordSystem	
Coordinate system used to determine the orientation and bounds of the thread. The origin of this coordinate system is considered the starting point of the thread.

tappedDepth	number	
Indicates how far the thread should be rendered from the thread origin.

threadPitch	number	
Distance between each adjacent thread.

debug
debug (context is Context, value, color is DebugColor)

Print and, if applicable, display value in a Part Studio, highlighting or creating entities in a chosen color, red by default.

The displayed data will ONLY be visible when the feature calling the debug function is being edited. Entities displayed during debug are for display only, and will not appear in any queries.

Values which can be debugged are:

Query: Highlights entities matching the Query (bodies, faces, edges, and vertices) in red.

3D length Vector: Displays a single point in world space.

Unitless, normalized 3D Vector: Displays an arrow starting at the world origin, pointing in the given direction.

Line: Displays an arrow starting at the line's origin, pointing in the line's direction.

CoordSystem: Displays three perpendicular arrows from the coordinate system's origin, along its three axes. The arrowhead for the x-axis is largest, and the z-axis is smallest.

Plane: Displays a large square in the positive quadrant of the plane, along with three arrows along the plane's x-axis, y-axis, and normal.

Box3d: Displays the edges of the bounding box (in the given coordinate system, if provided)

The overloads in this module define these behaviors.

Parameter	Type	Additional Info
color	DebugColor	
Optional

The color of the debug highlight

debug (context is Context, value)

debug (context is Context, value is ValueWithUnits, color is DebugColor)

debug (context is Context, value is Vector, color is DebugColor)

debug (context is Context, value is Query, color is DebugColor)

debug (context is Context, value is Line, color is DebugColor)

debug (context is Context, value is CoordSystem)

debug (context is Context, value is CoordSystem, color is DebugColor)

debug (context is Context, value is CoordSystem, xColor is DebugColor, yColor is DebugColor, zColor is DebugColor)

debug (context is Context, value is Plane, color is DebugColor)

debug (context is Context, point1 is Vector, point2 is Vector, color is DebugColor)

Draws a line between point1 and point2 and prints the points with the distance between them.

debug (context is Context, point1 is Vector, point2 is Vector)

debug (context is Context, boundingBox is Box3d, color is DebugColor)

Displays the edges of a Box3d in the world coordinate system with a chosen DebugColor.

debug (context is Context, boundingBox is Box3d, cSys, color is DebugColor)

Displays the edges of a Box3d in the given coordinate system with a chosen DebugColor.

EXAMPLE

const myBox = evBox3d(context, { "topology" : entities, "cSys" : myCSys });
debug(context, myBox, myCSys, DebugColor.RED);
debug (context is Context, boundingBox is Box3d, cSys)

addDebugEntities (context is Context, entities is Query, color is DebugColor)

Highlights entities in a given DebugColor, without printing anything.

As with debug, highlighted entities are only visible while the debugged feature's edit dialog is open.

addDebugEntities (context is Context, entities is Query)

addAuxiliaryEntities (context is Context, id is Id, entities is Query, color is DebugColor)

Highlights entities in a given DebugColor, without printing anything.

As with debug, highlighted entities are only visible while the edit dialog is open for featureId id.

addDebugPoint (context is Context, point is Vector, color is DebugColor)

Highlights a 3D point in a given DebugColor, without printing anything.

As with debug, highlighted entities are only visible while the debugged feature's edit dialog is open.

addDebugPoint (context is Context, point is Vector)

addAuxiliaryPoint (context is Context, id is Id, point is Vector, color is DebugColor)

Highlights a 3D point in a given DebugColor for the given feature Id, without printing anything.

addDebugLine (context is Context, point1 is Vector, point2 is Vector, color is DebugColor)

Draws a line in 3D space from point1 to point2 with a chosen DebugColor.

As with debug, highlighted entities are only visible while the debugged feature's edit dialog is open.

Parameter	Type	Additional Info
point1	Vector	
one endpoint of the line.

point2	Vector	
the other endpoint of the line.

addDebugLine (context is Context, point1 is Vector, point2 is Vector)

addAuxiliaryLine (context is Context, id is Id, point1 is Vector, point2 is Vector, color is DebugColor)

Draws a line in 3D space from point1 to point2 with a chosen DebugColor for the given feature Id.

Parameter	Type	Additional Info
point1	Vector	
one endpoint of the line.

point2	Vector	
the other endpoint of the line.

addDebugArrow (context is Context, from is Vector, to is Vector, radius is ValueWithUnits, color is DebugColor)

Draws an arrow in 3D space from from to to with a chosen DebugColor.

As with debug, highlighted entities are only visible while the debugged feature's edit dialog is open.

Parameter	Type	Additional Info
radius	ValueWithUnits	
Width of the four arrowhead lines

EXAMPLE

.25 * centimeter
addDebugArrow (context is Context, from is Vector, to is Vector, radius is ValueWithUnits)

startTimer (timer is string)

Starts the timer associated with the string timer or resets it. Use with printTimer(string).

startTimer ()

Starts the global timer associated with the empty string or resets it. Use with printTimer().

printTimer (timer is string)

Prints the elapsed milliseconds for the timer associated with the string timer. Use with startTimer(string).

Note that if the timer was set in a prior feature, the elapsed time may be very large because features can be regenerated at different times.

Throws an error if no such timer has been started.

printTimer ()

Prints the elapsed milliseconds for the global timer associated with the empty string. Use with startTimer().

Note that if the timer was set in a prior feature, the elapsed time may be very large because features can be regenerated at different times.

Throws an error if no such timer has been started.

decalUtils
DecalData type

Data representing a decal that is mapped onto a face.

Value	Type	Description
DecalData	map	
decalId
Id	
A unique id to represent the decal in the context of the face on which it is placed. The id should correspond to the id of the creating feature, or be a sub-id of the creating feature.

imageMappingType
ImageMappingType	
The type of projection mapping to use for this decal

image
ImageData	
The image that is being mapped.

uvTransform
TransformUV	
A post-projection transformation that is applied in UV space. This can be used to further translate, rotate, and scale a projected image.

planeSystem
PersistentCoordSystem	
Optional

A coordinate system representing the plane for the ImageMappingType.PLANAR type. This field must be defined if the imageMappingType field is of type ImageMappingType.PLANAR. The lower-left corner of the image will project to the plane's origin. The right edge of the image is along the positive X direction of the coordinate system. The top edge of the image is along the positive Y direction of the coordinate system. See planeToCSys for deriving a coordinate system from a Plane object.

cylinder
Cylinder	
Optional

The cylinder onto which the decal is mapped. This field must be defined if the imageMappingType field is of type ImageMappingType.CYLINDRICAL.

cylinderSystem
PersistentCoordSystem	
Optional

A coordinate system used in projecting the image onto the given cylinder. This field must be defined if the imageMappingType field is of type ImageMappingType.CYLINDRICAL. The coordinate system's origin must lie on the cylinder's axis with the system's Z axis aligned with the cylinder's own axis. The center of the horizontal extents of the image coincide with the intersection of the coordinate system's x axis and the cylinder. The center of the vertical extents of the image coincide with the projection of the coordinate system's origin on the cylinder. The top edge of the image is along the positive Z direction of the coordinate system projected on the cylinder.

createPlanarDecal (decalId is Id, image is ImageData, planeSystem is CoordSystem, uvTransform is TransformUV) returns DecalData

Creates data for a planar decal. This can be applied to a face using associateDecalAttribute.

See also

DecalData

Parameter	Type	Additional Info
decalId	Id	
The id to for the decal

image	ImageData	
The image to use for the data

planeSystem	CoordSystem	
The coordinate system to use for the planar projection

uvTransform	TransformUV	
A post-projection transform to apply to the decal

createCylindricalDecal (decalId is Id, image is ImageData, cylinder is Cylinder, uvTransform is TransformUV) returns DecalData

Creates data for a cylindrical decal. This can be applied to a face using associateDecalAttribute.

See also

DecalData

Parameter	Type	Additional Info
decalId	Id	
The id to for the decal

image	ImageData	
The image to use for the data

cylinder	Cylinder	
The cylinder definition to use for projection

uvTransform	TransformUV	
A post-projection transform to apply to the decal

associateDecalAttribute (context is Context, entities is Query, decalData is DecalData)

Associate the given decal data as an attribute on the entities provided. This will append the decal to any existing decals associated with the given entities.

Associating a decal in this way will cause the data to be transmitted to Onshape clients where they will be rendered.

createUvTransform (decalWidth is ValueWithUnits, mirrorHorizontal is boolean, decalHeight is ValueWithUnits, mirrorVertical is boolean, decalRotation is ValueWithUnits) returns TransformUV

Creates a UV transform suitable for scaling, mirroring, and rotating a decal after it's been projected.

Parameter	Type	Additional Info
decalWidth	ValueWithUnits	
The width of the decal, post-transformation

mirrorHorizontal	boolean	
If true, the image will be mirrored about its center horizontally

decalHeight	ValueWithUnits	
The height of the decal, post-transformation

mirrorVertical	boolean	
If true, the image will be mirrored about its center vertically

decalRotation	ValueWithUnits	
An amount of rotation to apply to decal about the image center.

getWorldSpacePosition (decalData is DecalData, uv is Vector)

Unprojects the given point in UV space to its corresponding world position for the given decal data. The UV is equivalent to the texture coordinate for the UV that is ultimately used to render the decal.

See also

getDecalUvSpacePosition

getDecalUvSpacePosition (decalData is DecalData, worldPosition is Vector)

Projects the given world position into UV space for the given decal data. The UV computed is equivalent to the texture coordinate for the UV that is ultimately used to render the decal.

See also

getWorldSpacePosition

IMAGE_SIZE_BOUNDS const

A LengthBoundSpec for positive image sizes.

IMAGE_OFFSET_BOUNDS const

A LengthBoundSpec for image offsets.

defaultFeatures
newContextWithDefaults () returns Context

Creates a Context with default planes and an origin.

qDefaultBodies () returns Query

A query for all default created bodies in a context, that is, the top, right, front planes and the origin point.

qFrontPlane (entityType is EntityType) returns Query

A query for the front plane.

Parameter	Type	Additional Info
entityType	EntityType	
Specify type FACE or BODY.

qRightPlane (entityType is EntityType) returns Query

A query for the right plane.

Parameter	Type	Additional Info
entityType	EntityType	
Specify type FACE or BODY.

qTopPlane (entityType is EntityType) returns Query

A query for the top plane.

Parameter	Type	Additional Info
entityType	EntityType	
Specify type FACE or BODY.

qOrigin (entityType is EntityType) returns Query

A query for the origin point.

Parameter	Type	Additional Info
entityType	EntityType	
Specify type VERTEX or BODY.

derive
derive (context is Context, id is Id, buildFunction is function, options is map) returns map

Merges context returned by buildFunction(options.configuration) into context.

Parameter	Type	Additional Info
options	map	
parts
Query	
Queries resolving to bodies in base context to be preserved.

configuration
map	
The configuration of the part studio.

clearSMDataFromAll
boolean	
Optional

Default is true. If set to false, for every part in options.parts belonging to an active sheet metal model all 3d parts and flats of that sheet metal model survive and remain active.

filterOutNonModifiable
boolean	
Optional

Default is true.

propagateMergeStatus
boolean	
Optional

Default is true.

noPartsError
ErrorStringEnum	
Optional

Error to be reported if options.parts resolves to empty array. If field is not specified ErrorStringEnum.IMPORT_DERIVED_NO_PARTS is used.

noPartsErrorParams
array	
Optional

queriesToTrack
map	
Optional

Map whose keys are Querys which resolve in the original derived context (that is, the context resulting from buildFunction). If set, the output field trackingResults will contain values which resolve to each query's equivalent entities in the current context.

mateConnectors
array	
Optional

Array of queries for mate connectors, to evaluate in the new context. If set, the output field mateConnectors will be a map from each query to its resulting transform.

mateConnectorIds
array	
Optional

Array of creating feature ids for mate connectors.

mateConnectorFeatureIndices
array	
Optional

Array of indices into mate connectors created by feature.

loadedContext
Context	
Optional

Preloaded context, if available, of the reference.

clearCustomProperties
boolean	
Optional

Default is false.

nameSuffix
string	
Optional

A suffix to append to names of parts coming from base part studio.

Return	Type	Description
map	
mateConnectors
map	
Map from mate connector query to Transform to that mate connector

trackingResults
map	
Map from Query keys of queriesToTrack to each query's value in the new context (given as an array of transient queries)

edgeBlendCommon
addFilletControlManipulator (context is Context, id is Id, definition is map, manipulatorEntity is Query)

Create a linear manipulator for radius or width parameter

onFilletControlManipulatorChange (context is Context, definition is map, newManipulators is map, manipulatorEntity is Query, widthFieldName is string) returns map

fillet manipulator change function

error
regenError (customMessage is string) returns map

regenError functions are used to construct maps for throwing to signal feature regeneration errors. Can either take a string for a custom message or an ErrorStringEnum for a built-in message. Custom messages are limited to ASCII characters. Messages longer than 200 characters will not be displayed fully.

EXAMPLE

throw regenError("Failed to attach widget: Boolean union failed")
EXAMPLE

throw regenError("Wall is too thin for this feature", ["wallWidth"]);
EXAMPLE

throw regenError(ErrorStringEnum.POINTS_COINCIDENT, ["points"]);
regenError (customMessage is string, faultyParameters is array) returns map

Parameter	Type	Additional Info
faultyParameters	array	
An array of strings that correspond to keys in the feature definition map. Throwing a regenError with faultyParameters will highlight them in red inside the feature dialog.

regenError (customMessage is string, entities is Query) returns map

Parameter	Type	Additional Info
entities	Query	
A query for entities to highlight in the Part Studio. Multiple queries can be combined and highlighted using the qUnion function. The entities are only highlighted when the feature dialog is open.

regenError (customMessage is string, faultyParameters is array, entities is Query) returns map

Parameter	Type	Additional Info
faultyParameters	array	
An array of strings that correspond to keys in the feature definition map. Throwing a regenError with faultyParameters will highlight them in red inside the feature dialog.

entities	Query	
A query for entities to highlight in the Part Studio. Multiple queries can be combined and highlighted using the qUnion function. The entities are only highlighted when the feature dialog is open.

regenError (message is ErrorStringEnum) returns map

The following overloads take an ErrorStringEnum rather than a custom message, and are using for all errors within the Onshape Standard Library. The enum values correspond to messages which can be translated into multiple languages.

regenError (message is ErrorStringEnum, faultyParameters is array) returns map

Parameter	Type	Additional Info
faultyParameters	array	
An array of strings that correspond to keys in the feature definition map. Throwing a regenError with faultyParameters will highlight them in red inside the feature dialog.

regenError (message is ErrorStringEnum, entities is Query) returns map

Parameter	Type	Additional Info
entities	Query	
A query for entities to highlight in the Part Studio. Multiple queries can be combined and highlighted using the qUnion function. The entities are only highlighted when the feature dialog is open.

regenError (message is ErrorStringEnum, faultyParameters is array, entities is Query) returns map

Parameter	Type	Additional Info
faultyParameters	array	
An array of strings that correspond to keys in the feature definition map. Throwing a regenError with faultyParameters will highlight them in red inside the feature dialog.

entities	Query	
A query for entities to highlight in the Part Studio. Multiple queries can be combined and highlighted using the qUnion function. The entities are only highlighted when the feature dialog is open.

regenError (message is ErrorStringEnum, regenErrorOptions is map) returns map

Parameter	Type	Additional Info
regenErrorOptions	map	
faultyParameters
An array of strings that correspond to keys in the feature definition map. Throwing a regenError with faultyParameters will highlight them in red inside the feature dialog.

entities
A query for entities to highlight in the Part Studio. Multiple queries can be combined and highlighted using the qUnion function. The entities are only highlighted when the feature dialog is open.

regenError (message is string, regenErrorOptions is map) returns map

Parameter	Type	Additional Info
regenErrorOptions	map	
faultyParameters
An array of strings that correspond to keys in the feature definition map. Throwing a regenError with faultyParameters will highlight them in red inside the feature dialog.

entities
A query for entities to highlight in the Part Studio. Multiple queries can be combined and highlighted using the qUnion function. The entities are only highlighted when the feature dialog is open.

reportFeatureWarning (context is Context, id is Id, message is ErrorStringEnum) returns boolean

Attaches a warning-level status to the given feature id.

reportFeatureWarning (context is Context, id is Id, customMessage is string) returns boolean

Attaches a custom warning-level status to the given feature id. Will display a notification to the user containing the specified message.

reportFeatureWarning (context is Context, id is Id, message is ErrorStringEnum, associatedParameters is array) returns boolean

Attaches custom warning-level status to the given feature id. Will display a notification to the user containing the specified message.

reportFeatureWarning (context is Context, id is Id, customMessage is string, associatedParameters is array) returns boolean

Attaches custom warning-level status to the given feature id. Will display a notification to the user containing the specified message.

reportFeatureInfo (context is Context, id is Id, message is ErrorStringEnum) returns boolean

Attaches an info-level status to the given feature id. Will display a notification to the user containing the specified message.

reportFeatureInfo (context is Context, id is Id, message is ErrorStringEnum, associatedParameters is array) returns boolean

Attaches an info-level status to the given feature id. Will display a notification to the user containing the specified message.

reportFeatureInfo (context is Context, id is Id, customMessage is string) returns boolean

Attaches a custom info-level status to the given feature id.

processSubfeatureStatus (context is Context, id is Id, options is map) returns boolean

Propagate the status of a subfeature to a feature.

Parameter	Type	Additional Info
options	map	
subfeatureId
Id	
The Id of the subfeature.

overrideStatus
ErrorStringEnum	
Optional

A status enum to use instead of the subfeature status enum if the subfeature has an info, warning, or error status.

featureParameterMap
map	
Optional

A mapping of the field names from subfeature to feature.

featureParameterMappingFunction
function	
Optional

A function to map field names from subfeature to feature.

propagateErrorDisplay
boolean	
Optional

Use subfeature error display when present. Default is false.

additionalErrorEntities
Query	
Optional

Additional error entities to display if the subfeature has an info, warning, or error status.

getFeatureStatus (context is Context, id is Id) returns FeatureStatus

Return the status of a feature as a FeatureStatus

reportFeatureStatus (context is Context, id is Id, status is FeatureStatus) returns boolean

Report the status of a feature

clearFeatureStatus (context is Context, id is Id, definition is map) returns boolean

Clear the status of a feature to StatusType.OK *

Parameter	Type	Additional Info
definition	map	
withDisplayData
boolean	
Optional

Clear status display data attached to feature. Default true.

getFeatureError (context is Context, id is Id)

Returns the error (as a string or an ErrorStringEnum) associated with the given feature id or undefined if none.

getFeatureWarning (context is Context, id is Id)

Returns the warning (as a string or an ErrorStringEnum) associated with the given feature id or undefined if none.

getFeatureInfo (context is Context, id is Id)

Returns the info status (as a string or an ErrorStringEnum) associated with the given feature id or undefined if none.

setErrorEntities (context is Context, id is Id, definition is map)

Causes the given entities to be shown in red. This display is not rolled back even if the feature fails and the entities themselves are rolled back.

Parameter	Type	Additional Info
definition	map	
entities
Query	
The entities to display.

featureHasError (context is Context, id is Id) returns boolean

Return type	Description
boolean	
true if the feature with the given id has an associated regeneration error.

featureHasNonTrivialStatus (context is Context, id is Id) returns boolean

Return type	Description
boolean	
true if the feature with the given id has an associated status different from OK.

faultyArrayParameterId (arrayParameter is string, itemIndex is number, innerParameter is string) returns string

Return type	Description
string	
A string identifier for marking an error on an array parameter when using the faultyParameters argument in any of the error reporting functions in error.fs.

FeatureStatus type

The status of a feature

Value	Type	Description
FeatureStatus	map	
statusType
StatusType	
faultyParameters
array	
statusEnum
ErrorStringEnum	
statusMsg
string	
canBeFeatureStatus (value) predicate

The faultyParameters cannot exist when the statusType is StatusType.OK. The statusEnum must be ErrorStringEnum.CUSTOM_ERROR if the statusMsg exists.

verify (condition is boolean, error)

If the condition check fails, this function throws the error.

Parameter	Type	Additional Info
condition	boolean	
The condition to test.

error		
The error to throw if condition is false, where error is of type ErrorStringEnum or string.

verify (condition is boolean, error, regenErrorOptions is map)

If the condition check fails, this function throws the error.

Parameter	Type	Additional Info
condition	boolean	
The condition to test.

error		
The error to throw if condition is false, where error is of type ErrorStringEnum or string.

regenErrorOptions	map	
The key-value pairs to pass to the thrown regenError, e.g. entities or faultyParameters.

extrudeCommon
SMExtrudeBoundingType enum

Bounding type used with SMProcessType.EXTRUDE

Value	Description
BLIND	
UP_TO_NEXT	
UP_TO_SURFACE	
UP_TO_BODY	
UP_TO_VERTEX	
feature
defineFeature (feature is function, defaults is map) returns function

This function takes a regeneration function and wraps it to create a feature. It is exactly like the one-argument version of defineFeature but the additional argument enables setting default values for feature parameters when they are not passed in.

Parameter	Type	Additional Info
defaults	map	
A map of default parameter values for when this feature is called in FeatureScript.

This does NOT control the user-visible default value when creating this feature. To change the user-visible default for booleans, enums, and strings, use the "Default" annotation. To change the user-visible default for a length, angle, or number, see the valueBounds module.

EXAMPLE

{} will not modify the definition.
EXAMPLE

{ "shouldFillet" : false } will set the parameter "shouldFillet" to false if the feature is called from FeatureScript without the "shouldFillet" parameter.
defineFeature (feature is function) returns function

This function takes a regeneration function and wraps it to create a feature. The wrapper handles certain argument recording for the UI and error handling. A typical usage is something like:

annotation { "Feature Type Name" : "Widget" } // This annotation is required for Onshape to recognize widget as a feature.
export const widget = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        ... // Specify the parameters that this feature takes
    }
    {
        ... // Specify what the feature does when regenerating
    });
For more information on writing features, see Specifying feature UI in the language guide.

Parameter	Type	Additional Info
feature	function	
A function that takes a context, an id, and a definition and regenerates the feature.

startFeature (context is Context, id is Id)

callSubfeatureAndProcessStatus (topLevelId is Id, fn is function, context is Context, subfeatureId is Id, definition is map)

This function can be used to call a subfeature or sub-operation (such as extrude or opExtrude, respectively). It will properly handle any statuses as if they came from the top level feature. That is, reported INFO will display as a blue message bubble, WARNING will turn the feature orange with a warning tooltip on hover, and ERROR will throw an error after status handling (aborting feature execution if it is not caught). Any error entities that the subfeature emits will also be displayed.

EXAMPLE

callSubfeatureAndProcessStatus(id, booleanBodies, context, id + "boolean", booleanDefinition); (where id is the top-level feature id passed into the feature) will call booleanBodies(context, id + "boolean", booleanDefinition), propagate its status onto the current feature, and show any error entities coming from the boolean.
Internally, calls the supplied function, and attaches any status it produces to the topLevelId using processSubfeatureStatus. If calling the function produces an error, the error is re-thrown. If the function produces a return value, that value is returned.

callSubfeatureAndProcessStatus (topLevelId is Id, fn is function, context is Context, subfeatureId is Id, definition is map, processSubfeatureStatusOptions is map)

See callSubfeatureAndProcessStatus.

Parameter	Type	Additional Info
processSubfeatureStatusOptions	map	
Passed as the definition argument to processSubfeatureStatus. Setting subfeatureId in this map is not required, and will be ignored in favor of the subfeatureId passed into this function.

forEachEntity (context is Context, id is Id, query is Query, operationToPerform is function)

Iterate through all entities provided by a query, calling the provided function once for each geometric entity resolved by the provided query.

forEachEntity behaves much like the code:

const evaluated = evaluateQuery(context, query);
for (var i = 0; i < size(evaluated); i += 1)
{
    operationToPerform(id + i, evaluated[i]);
}
However, forEachEntity has one additional benefit: The entId this function provides to operationToPerform is tied to the entity itself, not its index i. This means that downstream features made in the Part Studio will hold up better across upstream changes.

For example, imagine the following scenario: A user inserts a custom feature which places a slot on every selected line. That feature calls forEachEntity(context, lineQuery ...). The user then makes a sketch downstream which uses geometry from e.g. the third slot. Finally, the user decides some slots are unnecessary and deletes some of the lines. Since the feature used forEachEntity, the user's downstream sketch will still reference the same slots. If the feature instead used the code above, the user's sketch would break or jump around, since a different slot would suddenly become "slot 3".

Aside from that difference, the two are interchangable.

Like any expression function, be warned that the provided operationToPerform can read but can NOT modify the values of variables outside the function. It can, however, modify values inside a box.

EXAMPLE

const allParts = qAllModifiableSolidBodies();
const threshold = 0.01 * inch^3;
var deletedSizes is box = new box([]); // box containing an empty array
forEachEntity(context, id + "deleteSmallParts", allParts, function(entity is Query, id is Id)
{
    const size = evVolume(context, {
            "entities" : entity
    });
    if (size < threshold)
    {
        opDeleteBodies(context, id + "deleteBodies1", {
                "entities" : entity
        });
        deletedSizes[] = append(deletedSizes[], size);
    }
});
println(deletedSizes[]);
Parameter	Type	Additional Info
operationToPerform	function	
EXAMPLE

function(entity is Query, id is Id)
{
    // perform operations with the entity
}
The first argument to this function is a query resolving to one single entity of the input query.

The second argument to this function is a unique id tied to the entity. By default it is named "id", which will shadow (i.e. take precedence over) the outer variable named "id". If you need access to that outer id, simply rename this argument to e.g. innerId.

setFeatureComputedParameter (context is Context, id is Id, definition is map)

Associates a FeatureScript value with a given string. This value can then be referenced in a feature name using the string. The provided value can be used in a feature name by including e.g. "#myValue" in the Feature Name Template.

Parameter	Type	Additional Info
definition	map	
name
string	
EXAMPLE

myValue
value
getFullPatternTransform (context is Context) returns Transform

When in feature pattern scope returns composition of all pattern transforms pushed by setFeaturePatternInstanceData returns identity transform when out of scope

getRemainderPatternTransform (context is Context, definition is map) returns Transform

Making a feature work correctly with feature patterns is usually done with two functions: this one and transformResultIfNecessary.

Feature patterns work by first computing a sequence of transforms, one for each instance. For each transform, the pattern pushes it onto the pattern stack (using setFeaturePatternInstanceData), executes the patterned features, and then pops the transform off the stack (using unsetFeaturePatternInstanceData) before pushing the next one. The stack depth corresponds to the level of nesting of feature patterns. Feature authors are responsible for reading the pattern stack and transforming themselves accordingly.

The basic principle is that inside one feature pattern (as opposed to nested feature patterns), if any entities that the feature references come from a feature that is also being patterned, then the feature ignores the pattern transform. Otherwise, the feature uses the pattern transform in a "natural" way, applying it to an input, the output, or somewhere in between.

For example, suppose the patterned feature creates a 3D line between two arbitrary vertices. If the first vertex is also patterned, but not the second, then the result should be a bunch of lines from different instances of the first vertex to the unpatterned second vertex (this is accomplished by not applying any transform to the line). If neither vertex is patterned, the line should be transformed by the pattern transform and the result will be as expected, as if a body pattern of these lines was performed. Other features may need to apply the transform differently: for example, a sweep can transform the result of opSweep prior to the boolean, but an extrude needs to transform the profile prior to opExtrude to accommodate up-to-next correctly.

The general case is more complicated because feature patterns may be nested, and this function is designed to handle them. This function takes references, a query for everything the feature geometrically depends on (typically a qUnion of the queries in the feature definition), and computes the portion of the pattern transform that is not applied to any of the references and hence should be applied to the feature. For example, if one of the references is patterned by the current feature pattern or if there is no feature pattern, it will return the identity transform. If references evaluates to nothing, it will return the current feature pattern transform.

More precisely: Among references find topology created by pattern instance deepest in the pattern transform stack. If the transformation on the stack for that instance is S and the full transformation is F, the remainder R is such that R * S = F

A simple feature may use this function and transformResultIfNecessary as follows:

... // Feature definition boilerplate and precondition
    { // Feature body
        // Call getRemainderPatternTransform before performing any operations
        var remainingTransform = getRemainderPatternTransform(context, { "references" : definition.vertexToBuildOn });
        ... // Create a cube using definition.vertexToBuildOn as the reference location
        // Inside a feature pattern, the following will transform the cube if definition.vertexToBuildOn is not getting patterned:
        transformResultIfNecessary(context, id, remainingTransform);
        ... // Perhaps boolean the results to something in the context
    });
Parameter	Type	Additional Info
definition	map	
references
Query	
transformResultIfNecessary (context is Context, id is Id, transform is Transform)

Applies transformation to bodies created by operation with id if transform argument is non-trivial

isAnything (value) predicate

A predicate which always returns true. Used to create a generic feature parameter that can be any featurescript expression.

Note that to change the user-visible default value, the "Default" annotation must be a string containing a valid parameter expression. For example, to make the default value the string "My string", pass in an escaped string: annotation{ "Default": "\"My string\"" }.

lastModifyingOperationId (context is Context, query is Query) returns Id

Returns id of operation that created or last modified the first entity to which query resolves.

Throws if query resolves to nothing.

startTracking (context is Context, arg is map) returns Query

Generates a tracking query, which will evaluate to entities derived from subquery in features between startTracking and when query is evaluated. If secondarySubquery is specified, the query would evaluate to entities derived from both objects. If trackPartialDependency is set to true, query would also include entities that are not exclusively derived from subquery1. Optional field lastOperationId can be used to specify the starting operation of tracking. Use example:

// "sketch1" constructs a polygon of "line0", "line1", etc.
var extrudedFromLine0 = startTracking(context, id + "sketch1", "line0");
extrudeOp(context, id + "extrude1", {"entities" : qSketchRegion(id + "sketch1",....});
var fromLine0 = evaluateQuery(context, extrudedFromLine0);
// fromLine0 contains a face and two edges (top and bottom) corresponding to line0 in the extrude.
startTracking (context is Context, subquery is Query) returns Query

startTracking (context is Context, sketchId is Id, sketchEntityId is string) returns Query

startTrackingIdentity (context is Context, subquery is Query) returns Query

Generates a tracking query, which will evaluate to the new entities inheriting the identity of subquery evaluation result.

makeRobustQuery (context is Context, subquery is Query) returns Query

Generates query robust to identity-preserving changes

makeRobustQueriesBatched (context is Context, subquery is Query) returns array

Generates array of robust queries for each entity of the subquery

setExternalDisambiguation (context is Context, id is Id, query is Query)

Used to set external disambiguation for operations with unstable component in id. The disambiguation will be applied to results of sub-operations which otherwise don't track dependency e.g. Sketch , opPlane, opPoint

Parameter	Type	Additional Info
id	Id	
ends in unstable component

verifyNonemptyQuery (context is Context, definition is map, parameterName is string, errorToReport is string) returns array

Throws a regenError and marks the specified Query parameter as faulty if the specified Query parameter is not a Query which resolves to at least one entity. This happens when the user has not made any selection into the Query parameter, or when upstream geometry has changed such that the Querys of the Query parameter no longer resolve to anything. Should be used to check all non-optional Query parameters in a feature. By convention, errorToReport should take the form "Select parameter display name." For example, a parameter declared as follows:

annotation { "Name" : "Entities to use", "Filter" : EntityType.FACE }
definition.entitiesToUse is Query;
should verify that the input is nonempty in the following way:

EXAMPLE

verifyNonemptyQuery(context, definition, "entitiesToUse", "Select entities to use.")
Return type	Description
array	
An array representing the result of evaluating the Query parameter with evaluateQuery

verifyNonemptyArray (context is Context, definition is map, parameterName is string, errorToReport is string)

Throws a regenError and marks the specified array parameter as faulty if the specified array parameter does not have any entries. A parameter declared as follows:

annotation { "Name" : "Array items", "Item name" : "Array item" }
definition.arrayItems is array;
for (var arrayItem in definition.arrayItems)
{
   ...
}
could verify that the input is nonempty in the following way:

EXAMPLE

verifyNonemptyArray(context, definition, "arrayItems", "Add an array item.")
verifyNoMesh (context is Context, definition is map, parameterName is string)

Verifies that the definition[parameterName] Query does not contain mesh or mixed entities. Throws a regenError if definition[parameterName] references mesh topologies.

verifyNoMeshInBody (context is Context, definition is map, parameterName is string)

Verifies no body containing the specified query contains any mesh.

Parameter	Type	Additional Info
context	Context	
The application context.

definition	map	
The feature definition.

parameterName	string	
The key of definition that will be accessed to find the query.

adjustAngle (context is Context, angle is ValueWithUnits) returns ValueWithUnits

Adjust angle out of bounds angles to lie in [0 to 2pi] if the feature is new, do a range check otherwise.

isButton (value) predicate

True if the value is undefined and creates a button parameter.

setDimensionedEntities (context is Context, definition is map)

Tolerant dimensions require multiple pieces of information. This function specifies all of the information required for a dimension that cannot be specified in a tolerant quantity. Tolerant quantities are commonly declared in a feature using the UIHint.CAN_BE_TOLERANT or UIHint.CAN_BE_TOLERANT_DIAMETER UI hints in the annotation of the quantity parameter.

EXAMPLE

annotation { "Name" : "Depth", "UIHint": UIHint.CAN_BE_TOLERANT }
isLength(definition.depth, LENGTH_BOUNDS);
This hint enables users to set the quantity's tolerances, but is insufficient for representing a tolerant dimension. A tolerant dimension also needs to know the dimension type and which faces are being measured by the dimension, and can optionally include the direction in which to measure and other information.

EXAMPLE

setDimensionedEntities(context,
 {
    parameterId: 'depth',
    queries: [startQ, endQ],
    dimensionType: FeatureDimensionType.DISTANCE
 });
Optionally, by specifiying tolerances and nominal, this call can be used to set the tolerances without input from the user. This is useful for features that are specific to a manufacturing process, where the tolerances are known, and especially cases where the tolerances depend on input geometry or other calculations that exceed the capabilities of default tolerance rules. If tolerances and nominal are provided, it is not necessary for the quantity parameter to be tolerant, and UIHint.CAN_BE_TOLERANT does not need to be used. If the feature does provide UIHint.CAN_BE_TOLERANT for the parameter and the user has set a tolerance for the quantity, this call will fail. However, by using getTolerantParameterIds a feature can choose to set tolerances only if the user did not. In this way, a feature can provide a user with the ability to override the calculated tolerances.

See also

getTolerantParameterIds

Parameter	Type	Additional Info
definition	map	
parameterId
string	
The id of the tolerant quantity parameter in the feature definition.

queries
array	
An array of one query (for a radius or diameter dimension) or two queries (for other dimensions). The queries can evaluate to more than one face, but in that case each face should lie on the same underlying surface. See extrude and fillet for examples.

facePairs
array	
Required if queries is undefined

An array of pairs of queries (a pair is an array of two queries). Used for features where mulitple face pairs are subject to the same constraint but they are not all coincident, for example, a thin extrusion of a square where the thickness is tolerant.

dimensionType
FeatureDimensionType	
The type of the dimension.

measuresSolidAngle
boolean	
Optional

Used to specify which part of a circle an angle dimension refers to. The angle between two planes can be defined by two possible numbers that sum to 360 degrees. If this option is SOLID, then the angle is measured from the first face, in to the part. If this option is VOID, then the angle is measured from the first face, out of the part. If this option is not set for an angle, then the result is consistent but undefined. It is recommended that an option is always provided for angle dimensions.

measurementDirection
Vector	
Optional

Used with dimensions of type FeatureDimensionType.AXIS_DISTANCE. If this option is not set then the dimension measures the shortest distance between the axes. If this option is set then the dimension measures the distance between the axes in this direction.

measurementReferenceType
DimensionMeasurementReferenceType	
Optional

Used with dimensions of type FeatureDimensionType.AXIS_DISTANCE. Specifies whether to measure to the axis (AXIS), the minimum extent (MINIMUM), or the maximum extent (MAXIMUM) of cylindrical faces. Defaults to AXIS if not specified.

schemaClass
string	
Optional

On regeneration a dimension with a quantity with tolerance type ToleranceType.DEFAULT will set its tolerances given the nominal value and any default tolerances specified on the part. If this field is not set then the rule used will be either the default linear or angular rule, depending on the dimension type. If this field is set then the dimension will use the custom rule corresponding to the value. This field can also be a ToleranceSchemaClass to use a predefined class from the standard library. For example, you can set this to ToleranceSchemaClass.FILLET_RADIUS to use the same tolerance rules as Onshape's official fillet feature.

tolerances
ToleranceInfo	
Optional

Contains tolerance and precision information for the specified parameter. This cannot be set if the parameter has been marked tolerant by the user.

nominal
ValueWithUnits	
Required if tolerances is not undefined

Required if setting tolerances, for either an existing or new parameter. For an existing feature parameter, this is usually the value of that parameter.

getTolerantParameterIds (context is Context, definition is map) returns map

Call this function within the body of a feature to find all tolerant quantity parameters. See setDimensionedEntities for more details.

Return type	Description
map	
A map where the keys are the ids of tolerant quantity parameters for the current feature. The values are empty maps.

setFeatureHiddenParameters (context is Context, id is Id, parameters is array)

Hide the provided parameters from the feature dialog. Currently only supports array elements (e.g. "arrayParameter\[2\]")

Parameter	Type	Additional Info
parameters	array	
An array of parameter ids that we want to hide in the feature dialog.

featureList
Support functions for feature lists (as used for featurePattern)

FeatureList type

Parameter type for inputting a list of features, stored as a map from feature Id to feature function. For an example, see the circularPattern module.

canBeFeatureList (value) predicate

Typecheck for FeatureList

featureList (features is map) returns FeatureList

Takes a map from id to lambda to return it as type FeatureList

valuesSortedById (context is Context, idToValue is map) returns array

Takes a context and a map whose keys are subfeature ids from that context. Returns the values from that map sorted in the order that the subfeatures were started.

flatOperationType
FlatOperationType enum

Types of flat operations supported by SMFlatOp

Value	Description
ADD	
REMOVE	
formedUtils
setFormAttribute (context is Context, bodies is Query, attribute is string)

Attach the given FormAttribute to the bodies.

qBodiesWithFormAttribute (attribute is string)

Query for all bodies marked with a FormAttribute and value exactly equal to attribute

See also

setFormAttribute

qBodiesWithFormAttribute (queryToFilter is Query, attribute is string) returns Query

Query for all bodies in queryToFilter marked with a FormAttribute and value exactly equal to attribute

See also

setFormAttribute

qBodiesWithFormAttributes (queryToFilter is Query, attributes is array) returns Query

Query for all bodies in queryToFilter marked with a FormAttribute and value exactly equal to one of the attributes

See also

setFormAttribute

computeFormArtifactsToDelete (context is Context, bodiesToKeep is Query, toDelete is Query) returns Query

Used in derived to ensure that form bodies attached to flat pattern about to be deleted are also deleted BEL-238166

frameAttributes
FrameTopologyType enum

The possible types of a FrameTopologyAttribute.

Value	Description
SWEPT_FACE	
The side faces of a frame, swept from the edges of the profile

SWEPT_EDGE	
The side edges of a frame, swept from the vertices of the profile

CAP_FACE	
The start and end cap faces of a frame

FrameProfileAttribute type

An attribute attached to the frame profile and the constructed frame body which defines the default cutlist associated with the frame.

frameProfileAttribute (value is map) returns FrameProfileAttribute

Construct a FrameProfileAttribute.

getFrameProfileAttributes (context is Context, frames is Query)

Get all FrameProfileAttributes attached to the frames.

getFrameProfileAttribute (context is Context, frame is Query)

Get the FrameProfileAttribute attached to the frame. Throw if a single attribute is not found.

setFrameProfileAttribute (context is Context, frame is Query, attribute is FrameProfileAttribute)

Attach the given FrameProfileAttribute to the frame.

FrameTopologyAttribute type

An attribute assigned to certain faces and edges of the frames to aid in tracking the frame as it changes over the series of frame-altering features.

frameTopologyAttributeForSwept (topologyType is FrameTopologyType) returns FrameTopologyAttribute

Construct a FrameTopologyAttribute for SWEPT_* types.

See also

frameTopologyAttributeForCapFace

frameTopologyAttributeForCapFace (isStartFace is boolean, isFrameTerminus is boolean, isCompositeTerminus is boolean) returns FrameTopologyAttribute

Construct a FrameTopologyAttribute for CAP_FACE.

See also

frameTopologyAttributeForSwept

getFrameTopologyAttributes (context is Context, faces is Query)

Get all FrameTopologyAttributes attached to the faces.

getFrameTopologyAttribute (context is Context, face is Query)

Get the FrameTopologyAttribute attached to the face. Throw if a single attribute is not found.

setFrameTopologyAttribute (context is Context, entities is Query, attribute is FrameTopologyAttribute)

Attach the given FrameTopologyAttribute to each of the entities.

CutlistAttribute type

An attribute attached to the composite created by the Cutlist feature which contains the cutlist table for that composite.

cutlistAttribute (featureId is Id, table is Table) returns CutlistAttribute

Construct a CutlistAttribute.

getCutlistAttributes (context is Context, composites is Query)

Get all CutlistAttributes attached to the composites.

getCutlistAttribute (context is Context, composite is Query)

Get the getCutlistAttribute attached to the composite. Throw if a single attribute is not found.

setCutlistAttribute (context is Context, composite is Query, attribute is CutlistAttribute)

Attach the given CutlistAttribute to the composite.

setCustomFrameAlignmentPointAttribute (context is Context, pointsQuery is Query)

Sets an attribute on the sketch entity point queries for later discovery and use during frame creation.

getCustomFrameAlignmentPoints (context is Context, profileId is Id) returns Query

Finds the sketch points in the profileId sketch with the custom alignment point attribute.

holeUtils
HoleStyle enum

Defines whether each hole should have a countersink, a counterbore, or neither.

Value	Description
SIMPLE	
C_BORE	
C_SINK	
HoleProfile type

Describes a single profile for a HoleDefinition.

See also

holeProfile for standard circular profiles.

holeProfileBeforeReference for a circular profile meant to be used as the first profile of the hole.

matchedHoleProfile for a profile that geometrically matches the HolePositionReference.

Value	Type	Description
HoleProfile	map	
positionReference
HolePositionReference	
The reference along the hole axis to which this profile is relative.

beforeReference
boolean	
Optional

Whether the position of the profile should reference the start or end of the given positionReference. See holeProfileBeforeReference for more detail. Default is false if not provided. Only considered when profileType is POSITIONED, ignored otherwise.

profileType
HoleProfileType	
How the profile should be constructed in relation to the given positionReference

position
ValueWithUnits	
Required if profileType is POSITIONED

The position of the profile along the hole axis, relative to the given positionReference.

radius
ValueWithUnits	
The radius of the profile. Can be 0 to specify that the profile forms a point.

targetMustDifferFromPrevious
boolean	
Optional

If true, instructs opHole to skip the construction of any holes in which the target referenced by this profile's positionReference is not different than the target reference by the previous profile's positionReference. Cannot be set to true on the first profile or any profile that does not have a different positionReference than the previous profile. Default is false.

notApplicableForFirstTarget
boolean	
Optional

If true, instructs opHole to skip the profiles in which the target referenced by this profile's positionReference is not different than the target reference by the GBTHolePositionReference::TARGET_START. Cannot be set to true on the first profile Default is false.

name
string	
Optional

A name for to assign to the edge created by opHole which corresponds to this profile. Supplying a name allows for the querying of profile edges by name when using qOpHoleProfile.

canBeHoleProfile (value) predicate

Typecheck for HoleProfile

holeProfile (positionReference is HolePositionReference, position is ValueWithUnits, radius is ValueWithUnits, optionalParameters is map) returns HoleProfile

Returns a new circular HoleProfile at a given position in relation to the end of the range of the positionReference. See HolePositionReference for further detail about the range of the positionReference.

Parameter	Type	Additional Info
optionalParameters	map	
targetMustDifferFromPrevious
boolean	
Optional

See HoleProfile.

notApplicableForFirstTarget
boolean	
Optional

See HoleProfile.

name
string	
Optional

See HoleProfile.

holeProfile (positionReference is HolePositionReference, position is ValueWithUnits, radius is ValueWithUnits) returns HoleProfile

holeProfileBeforeReference (positionReference is HolePositionReference, position is ValueWithUnits, radius is ValueWithUnits, optionalParameters is map) returns HoleProfile

Returns a new circular HoleProfile at a given position in relation to the beginning of the range of the positionReference. See HolePositionReference for further detail about the range of the positionReference. This type of profile is useful as the first profile of a hole, such that if the hole cylinder intersects the first target at a slanted or otherwise irregular face, the first profile is backed up enough such that when the hole tool is subtracted from the target, there is no undesirable overhang left behind.

Parameter	Type	Additional Info
optionalParameters	map	
targetMustDifferFromPrevious
boolean	
Optional

See HoleProfile.

notApplicableForFirstTarget
boolean	
Optional

See HoleProfile.

name
string	
Optional

See HoleProfile.

holeProfileBeforeReference (positionReference is HolePositionReference, position is ValueWithUnits, radius is ValueWithUnits) returns HoleProfile

matchedHoleProfile (positionReference is HolePositionReference, radius is ValueWithUnits, optionalParameters is map) returns HoleProfile

Returns a new HoleProfile that is geometrically matched to the positionReference. This is useful for configurations like blind-in-last, where a transition from one radius to another must be made that matches the shape of the position reference, to avoid the hole tool intersecting incorrectly with the part(s) in question. To form a valid HoleDefinition, MATCHED profiles must come in pairs of different radii.

Parameter	Type	Additional Info
optionalParameters	map	
targetMustDifferFromPrevious
boolean	
Optional

See HoleProfile.

notApplicableForFirstTarget
boolean	
Optional

See HoleProfile.

name
string	
Optional

See HoleProfile.

matchedHoleProfile (positionReference is HolePositionReference, radius is ValueWithUnits) returns HoleProfile

HoleDefinition type

Describes the shape of a hole using a series of HoleProfiles.

See also

opHole

Value	Type	Description
HoleDefinition	map	
profiles
array	
An array of HoleProfiles which define the shape of the hole. The profiles are interpreted in order, from the top to the bottom of the hole. The final profile must have a radius of 0. Each profile must specify a unique name, or all of the profiles must leave their name field undefined. If two or more adjacent profiles in the list end up being identical (in the same position with the same radius) when their final placement is determined in opHole, the identical profiles will be collapsed into a single profile, which uses the name of the first of the identical profiles.

faceNames
array	
Optional

A list of names to assign to the faces created by opHole. Should be the same length as the profiles array, where faceNames[i] is the name of the face created between profiles i - 1 and i, and faceNames[0] is the name of the top cap face (the face before profile 0). If any profiles are collapsed, the names of the faces between the collapsed profiles are skipped. Supplying faceNames allows for the querying of faces by name when using qOpHoleFace.

canBeHoleDefinition (value) predicate

Typecheck for HoleDefinition

holeDefinition (profiles is array, optionalParameters is map) returns HoleDefinition

Returns a new HoleDefinition.

Parameter	Type	Additional Info
optionalParameters	map	
faceNames
string	
Optional

See HoleDefinition.

holeDefinition (profiles is array) returns HoleDefinition

instantiator
The instantiator makes it easy to efficiently bring in (possibly configured) bodies from other Part Studios and place them at specific positions and orientations. The usage pattern is generally as follows:

firstPartStudio::import(...);
secondPartStudio::import(...);
// later, in a feature
const instantiator = newInstantiator(id + "myId");
var firstQuery = addInstance(instantiator, firstPartStudio::build, {
                                 "configuration" : { "configurationInput" : configurationValue },
                                 "transform"     : transform(vector(1, 2, 3) * inch)
                             });
var secondQuery = addInstance(instantiator, secondPartStudio::build, {
                                  "configuration" : secondConfiguration,
                                  "transform"     : someOtherTransform,
                                  "mateConnector" : queryForMateConnectorInSecondPartStudio // Specifies the origin
                              });
// repeat the above as necessary
instantiate(context, instantiator); // This call actually brings in the bodies
// Now firstQuery and secondQuery will resolve to the instantiated geometry
Internally, the instantiator groups all added instances by Part Studio and configuration. The final call to instantiate() is optimized so that any duplicates of the same Part Studio and the same configuration are patterned instead of re-derived, resulting in better performance and scalability for features instantiating the same bodies multiple times.

Instantiator type

Stores the data associated with using instantiator functionality.

canBeInstantiator (value) predicate

Typecheck for Instantiator

newInstantiator (id is Id) returns Instantiator

Creates a new instantiator with the specified id and default options.

newInstantiator (id is Id, options is map) returns Instantiator

Creates a new instantiator.

Parameter	Type	Additional Info
id	Id	
The root id for all instances that will be created by this instantiator. Multiple instantiators can be used simultaneously, as long as they have different ids.

options	map	
Optional

partQuery
Query	
Optional

The query for all bodies to be brought in from the part studios. Default is all bodies except sketches.

tolerances
map	
Optional

The tolerances for variable configuration inputs. Default is 1e-8 meters for lengths, 1e-11 radians for angles, and 0 for numbers. The default tolerances for lengths, angles, and numbers can be specified using the (LENGTH_UNITS), (ANGLE_UNITS), and (unitless) keys, respectively. The tolerance for a specific configuration input can be specified using that input name as the key.

EXAMPLE

{ (LENGTH_UNITS) : 1e-4 * meter, (unitless) : 1e-8, "count" : 0 } causes length configuration variables that differ by less than 1e-4 meters to be considered identical, as well as numberical configuration variables that differ by less than 1e-8, except that configuration variables named "count" are compared exactly.
addInstance (instantiator is Instantiator, build is function, definition is map) returns Query

Adds an instance to the instantiator (does not actually create it in a context) with the given build function. The definition can specify the configuration, the transform, and how the result is identified.

Parameter	Type	Additional Info
definition	map	
configuration
map	
Optional

The configuration of the part studio.

partQuery
query	
Optional

A query which evaluates to bodies in new context, to be instantiated for this instance. If absent partQuery of instantiator is used. When present, overrides partQuery of the instantiator.

transform
Transform	
Optional

The transform to be applied to the geometry.

mateConnector
Query	
Optional

A query for all mate connectors from the part studio being instantiated, specifying its coordinate system.

mateConnectorId
Id	
Optional

Creating feature Id of the mate connector used for transformation.

mateConnectorIndex
number	
Optional

Index into the creating feature of the mate connector used for transformation.

name
string	
Optional

The id component for this instance. Must be unique per instantiator. If it is not specified, one is automatically generated based on order. If it is specified, the query returned is qCreatedBy(id + name, EntityType.BODY), where id is the id that was passed into newInstantiator

identity
Query	
Optional

If provided, specifies an entity whose identity controls the identity of the instance, so that queries for the instance can be robust. For example, if creating instances based on a layout sketch, one instance per line segment, the identity should be a query for the corresponding line segment.

loadedContext
Context	
If a preloaded context is provided, use this context

Return type	Description
Query	
a query that will resolve to the bodies instantiated once instantiate is run.

addInstance (instantiator is Instantiator, partStudio is PartStudioData, definition is map) returns Query

Add an instance with the buildFunction, partQuery, and configuration of a PartStudioData value.

Parameter	Type	Additional Info
definition	map	
transform
Transform	
Optional

The transform to be applied to the geometry.

mateConnector
Query	
Optional

A query for a mate connector in the part studio being instantiated, specifying its coordinate system.

mateConnectorId
Id	
Optional

Creating feature Id of the mate connector used for transformation.

mateConnectorIndex
number	
Optional

Index into the creating feature of the mate connector used for transformation.

configurationOverride
map	
Optional

If set, the values will be merged with the configuration set in partStudio, overriding any configuration inputs with matching keys.

name
string	
Optional

The id component for this instance. Must be unique per instantiator. If it is not specified, one is automatically generated based on order. If it is specified, the query returned is qCreatedBy(id + name, EntityType.BODY), where id is the id that was passed into newInstantiator

identity
Query	
Optional

If provided, specifies an entity whose identity controls the identity of the instance, so that queries for the instance can be robust. For example, if creating instances based on a layout sketch, one instance per line segment, the identity should be a query for the corresponding line segment.

loadedContext
Context	
If a preloaded context is provided use this context

Return type	Description
Query	
a query that will resolve to the bodies instantiated once instantiate is run.

addInstance (instantiator is Instantiator, partStudio is PartStudioData) returns Query

Add an instance with the buildFunction, partQuery, and configuration of a PartStudioData value.

Return type	Description
Query	
a query that will resolve to the bodies instantiated once instantiate is run.

instantiate (context is Context, instantiator is Instantiator)

Create the instances (in the provided context) that were added to the instantiator

libraryValidation
LibraryValidationProblems type

A container for a list of distinct problems found when validating a part studio for use in a library

manipulator
A manipulator is an alternative, graphical UI for controlling a feature's definition. For example, in Onshape's extrude feature, the arrow which appears at the end of a blind extrusion is a manipulator controlling the depth parameter. A manipulator can be one of a few ManipulatorTypes, which are generally draggable arrows designed to control different degrees of freedom.

The manipulator is added inside the feature function, and will be rendered whenever that feature is being edited. Changes to a manipulator will be processed by a "Manipulator Change Function" associated with the feature.

A small example using a manipulator to control the depth and direction of an opExtrude is below:

annotation { "Feature Type Name" : "Fake extrude",
        "Manipulator Change Function" : "fakeExtrudeManipulatorChange" }
export const fakeExtrude = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Faces to extrude", "Filter" : EntityType.FACE }
        definition.faces is Query;
        annotation { "Name" : "My Length" }
        isLength(definition.depth, LENGTH_BOUNDS);
        annotation { "Name" : "Opposite direction", "UIHint" : UIHint.OPPOSITE_DIRECTION }
        definition.shouldFlip is boolean;
    }
    {
        var extrudePlane is Plane = evFaceTangentPlane(context, {
                "face" : definition.faces,
                "parameter" : vector(0.5, 0.5)
        });
        var extrudeManipulator is Manipulator = linearManipulator({
                "base" : extrudePlane.origin,
                "direction" : extrudePlane.normal,
                "offset" : definition.shouldFlip ? definition.depth : -definition.depth,
                "primaryParameterId" : "depth"
        });
        addManipulators(context, id, {
                "myManipulator" : extrudeManipulator
        });
        opExtrude(context, id + "extrude1", {
                "entities" : definition.faces,
                "direction" : definition.shouldFlip ? extrudePlane.normal : -extrudePlane.normal,
                "endBound" : BoundingType.BLIND,
                "endDepth" : definition.depth
        });
    }, {});
export function fakeExtrudeManipulatorChange(context is Context, definition is map, newManipulators is map) returns map
{
    var newDepth is ValueWithUnits = newManipulators["myManipulator"].offset;
    definition.depth = abs(newDepth);
    definition.shouldFlip = newDepth > 0;
    return definition;
}
The manipulator change function is responsible for changing the definition such that the feature will regenerate correctly. It may change the definition in any way, and need not be restricted to the pattern of one manipulator changing one parameter.

The feature function is only aware of the definition passed in; it makes no distinction about whether the definition was produced from a manipulator change, or by a change in the feature dialog, or by another custom feature.

Manipulator type

A Manipulator is a type which can be passed into addManipulators, containing the necessary information to position the manipulator in the context. Altered copies of these manipulators are passed into a manipulator change function as newManipulators.

Can be constructed with triadManipulator, linearManipulator, and other functions below.

canBeManipulator (value) predicate

Typecheck for Manipulator

triadManipulator (definition is map) returns Manipulator

Create a manipulator represented by a triad of perpendicular arrows, aligned with the world axes, which specify a 3D position. See transformCopy for an example.

Parameter	Type	Additional Info
definition	map	
base
The position of the manipulator when the offset is 0.

offset
The 3D position of the triad, relative to the base.

sources
Optional

For Onshape internal use.

fullTriadManipulator (definition is map) returns Manipulator

Create a manipulator represented by a triad of perpendicular arrows, planes, angular position handles, which specify 3D transform.

Parameter	Type	Additional Info
definition	map	
base
The coordinate system the manipulator is aligned with when transform is the identity transform. Default is WORLD_COORD_SYSTEM.

transform
The 3D transform of the triad, relative to the base coordinate system.

displayEditView
Optional

if true, display an edit text box when doing a linear drag or a rotation. Default is false.

dragType
Optional

Which part of the manipulator is being dragged, if any. Only used in manipulator handling.

triadManipulator (base is Vector, offset is Vector, sources) returns Manipulator

Deprecated: Use triadManipulator(map)

linearManipulator (definition is map) returns Manipulator

Create a manipulator represented by a single arrow which can move along a single axis. See extrude for an example.

Parameter	Type	Additional Info
definition	map	
base
The position of the manipulator when the offset is 0.

direction
A 3D unit vector pointing on the axis on which the manipulator can be dragged.

offset
The positive or negative distance along direction from the base to the manipulator.

sources
Optional

For Onshape internal use.

minValue
ValueWithUnits	
Optional

The minimum offset allowed.

maxValue
ValueWithUnits	
Optional

The maximum offset allowed.

style
ManipulatorStyleEnum	
Optional

primaryParameterId
string	
Optional

The id of the definition field which is being manipulated. When set, the feature dialog focus will be shifted to the parameter in question when the manipulator is manipulated.

linearManipulator (base is Vector, direction is Vector, offset is ValueWithUnits, sources, style is ManipulatorStyleEnum) returns Manipulator

Deprecated: Use linearManipulator(map)

linearManipulator (base is Vector, direction is Vector, offset is ValueWithUnits, sources) returns Manipulator

Deprecated: Use linearManipulator(map)

linearManipulator (base is Vector, direction is Vector, offset is ValueWithUnits) returns Manipulator

Deprecated: Use linearManipulator(map)

angularManipulator (definition is map) returns Manipulator

Create a manipulator represented by a curved arrow which can move along a circumference to specify an angle, with the start and end of the rotation angle delimited by radial lines. See revolve for an example.

Parameter	Type	Additional Info
definition	map	
axisOrigin
Vector	
The origin of the axis to rotate around.

EXAMPLE

project(axis, rotationOrigin)
axisDirection
Vector	
The direction of the axis to rotate around.

EXAMPLE

axis.direction
rotationOrigin
Vector	
Point at the tip of the revolve manipulator.

angle
ValueWithUnits	
Current angle value of the manipulator.

sources
Optional

For Onshape internal use.

minValue
ValueWithUnits	
Optional

The minimum angle allowed.

maxValue
ValueWithUnits	
Optional

The maximum angle allowed.

style
ManipulatorStyleEnum	
Optional

primaryParameterId
string	
Optional

The id of the definition field which is being manipulated. When set, the feature dialog focus will be shifted to the parameter in question when the manipulator is manipulated.

disableMinimumOffset
boolean	
Optional

Removes the minimum offset between the arrow and axisOrigin.

pointsManipulator (definition is map) returns Manipulator

A set of points which can be selected one at a time.

Parameter	Type	Additional Info
definition	map	
points
array	
Array of 3d locations for points

index
number	
The index of the currently selected point

togglePointsManipulator (definition is map) returns Manipulator

A series of points which can each be selected individually.

Parameter	Type	Additional Info
definition	map	
points
array	
Array of 3d locations for points

selectedIndices
array	
The indices of the currently selected points

suppressedIndices
array	
The indices of any non-selectable points

flipManipulator (definition is map) returns Manipulator

Create a manipulator represented by a single arrow which flips direction when clicked.

Parameter	Type	Additional Info
definition	map	
base
Vector	
A 3d point at the manipulator's origin

EXAMPLE

vector(0, 0, 0) * meter
direction
Vector	
A 3d vector pointing in the unflipped direction

EXAMPLE

vector(0, 0, 1) points manipulator along the z axis
flipped
boolean	
EXAMPLE

false points the manipulator along +direction
EXAMPLE

true points the manipulator along -direction, or otherDirection if defined
sources
Optional

For Onshape internal use.

style
ManipulatorStyleEnum	
Optional

otherDirection
Vector	
Optional

A 3d vector for the flipped direction

flipManipulator (base is Vector, direction is Vector, flipped is boolean, sources, style is ManipulatorStyleEnum) returns Manipulator

Deprecated: Use flipManipulator(map)

flipManipulator (base is Vector, direction is Vector, flipped is boolean, sources) returns Manipulator

Deprecated: Use flipManipulator(map)

flipManipulator (base is Vector, direction is Vector, flipped is boolean) returns Manipulator

Deprecated: Use flipManipulator(map)

addManipulators (context is Context, id is Id, manipulators is map)

Add a manipulator to this feature, which will be visible and interactable when a user edits the feature.

addManipulators should be called within the feature function, with the offset on the added manipulator set to match the state of the definition.

Parameter	Type	Additional Info
manipulators	map	
A map whose keys will match the keys of newManipulators (passed into the Manipulator Change Function), and whose values are the Manipulators to be added.

path
Path type

Represents a series of connected edges which form a continuous path.

Value	Type	Description
Path	map	
edges
array	
The edges that form this Path, in the order of the Path.

flipped
array	
An array of booleans corresponding to each edge in the path, set to true to traverse the edge backwards.

closed
boolean	
Whether the Path is a closed path.

adjacentFaces
Query	
Optional

All adjacent faces on one side of the Path.

canBePath (value) predicate

Typecheck for Path

PathDistanceInformation type

Distance information returned by constructPath and evPathTangentLines when either function is provided with referenceGeometry

Value	Type	Description
PathDistanceInformation	map	
distance
ValueWithUnits	
The distance between the the start of the Path and the center of the bounding box of referenceGeometry, or infinity if referenceGeometry is empty

withinBoundingBox
boolean	
Whether the start of the Path is within the bounding box of referenceGeometry, or false if referenceGeometry is empty

canBePathDistanceInformation (value) predicate

Typecheck for PathDistanceInformation

defaultPathDistanceInformation () returns PathDistanceInformation

Returns a PathDistanceInformation with distance set to infinity and withinBoundingBox set to false

reverse (path is Path) returns Path

Reverse the direction of a Path

Parameter	Type	Additional Info
path	Path	
the Path to reverse.

constructPath (context is Context, edgesQuery is Query) returns Path

Construct a Path from a Query of edges, picking the starting point of the path based on query evaluation order for edgesQuery

Parameter	Type	Additional Info
edgesQuery	Query	
A Query of edges to form into a Path. The edges are ordered with query evaluation order, so a qUnion should be used to ensure a stable ordering.

constructPath (context is Context, edgesQuery is Query, options is map) returns map

Construct a Path from a Query of edges, optionally picking the starting point as the closest viable starting point to the supplied referenceGeometry

Parameter	Type	Additional Info
edgesQuery	Query	
A Query of edges to form into a Path.

options	map	
referenceGeometry
Optional

A geometry Query to determine the start of the Path. If unspecified, (or the query is empty) the starting point of the path will be based on query evaluation order for edgesQuery.

tolerance
ValueWithUnits	
Optional

Tolerance with length units indicating how close endpoints need to be to be considered part of the same path. Default is 1e-8 * meter

EXAMPLE

1e-5 * meter
Return	Type	Description
map	
path
Path	
The resulting constructed Path

pathDistanceInformation
PathDistanceInformation	
A map containing the distance from the Path start point to the center of the bounding box of referenceGeometry and whether the Path start point falls inside that bounding box.

evPathLength (context is Context, path is Path) returns ValueWithUnits

Return type	Description
ValueWithUnits	
The total length of the Path.

evPathTangentLines (context is Context, path is Path, parameters is array) returns map

Return tangent lines to a Path using arc length parameterization.

Parameter	Type	Additional Info
path	Path	
The Path to use.

parameters	array	
An array of numbers in the range 0..1 indicating where along the Path to evaluate tangents.

Return	Type	Description
map	
tangentLines
array	
The tangent Lines corresponding to each parameter

edgeIndices
array	
The indices of the edges in the Path corresponding to each parameter

evPathTangentLines (context is Context, path is Path, parameters is array, referenceGeometry) returns map

Return tangent lines to a Path using arc length parameterization. By default, the 0 parameter of the Path will be the start of the Path. If evaluating a closed path, providing reference geometry will alter the 0 parameter to be the closest point on the Path to the reference geometry. Providing reference geometry for a non-closed Path will not change the parameterization of the Path

Parameter	Type	Additional Info
path	Path	
The Path to use.

parameters	array	
An array of numbers in the range 0..1 indicating where along the Path to evaluate tangents.

referenceGeometry		
A geometry Query to determine the 0 parameter of the Path, or undefined. If an empty Query or undefined is specified, the tangents will be evaluated starting at the beginning of the path.

Return	Type	Description
map	
tangentLines
array	
The tangent Lines corresponding to each parameter

edgeIndices
array	
The indices of the edges in the Path corresponding to each parameter

pathDistanceInformation
PathDistanceInformation	
A map containing the distance from the remapped 0 parameter to the center of the bounding box of referenceGeometry and whether the remapped 0 parameter falls inside that bounding box. Only valid if the path is closed.

getPathEndVertices (context is Context, path is Path) returns Query

Return query to end vertices of path if open or qNothing if closed.

Parameter	Type	Additional Info
path	Path	
The Path to use.

patternCommon
PatternType enum

The type of pattern.

Value	Description
PART	
Creates copies of bodies.

FEATURE	
Calls a feature function multiple times, first informing the context of the transform to be applied.

FACE	
Creates copies of faces and attempts to merge them with existing bodies.

MirrorType enum

The type of mirror.

See also

PatternType

Value	Description
PART	
FEATURE	
FACE	
patternUtils
applyPattern (context is Context, id is Id, definition is map, remainingTransform is Transform)

Applies the body, face, or feature pattern, given just transforms and instance names

Parameter	Type	Additional Info
definition	map	
patternType
PatternType	
entities
Query	
Required if patternType is not FEATURE

The faces or parts to pattern.

instanceFunction
FeatureList	
Required if patternType is FEATURE

The features to pattern.

transforms
array	
An array of Transforms in which to place new instances.

instanceNames
array	
An array of the same size as transforms with a string for each transform, used in later features to identify the entities created.

properties
Properties include name, appearance, material, and part number (see PropertyType). They can be set in FeatureScript, but not read.

setProperty (context is Context, definition is map)

Sets a property on a set of bodies and/or faces. The allowed properties are listed in PropertyType. Only APPEARANCE and NAME properties are supported for faces.

Note: Any properties set in this way will be overridden if they are set directly in the Part Studio (via "Rename", "Set appearance", or the properties dialog). In that case the property value provided in FeatureScript will become shadowed. For example, if a part number is set in a custom feature based on the configuration, manually editing the part number from the properties dialog will override the custom feature's part number for all configurations.

Parameter	Type	Additional Info
definition	map	
entities
Query	
The bodies and/or faces to apply the property to.

propertyType
PropertyType	
The property to set.

EXAMPLE

PropertyType.APPEARANCE to change the part appearance.
customPropertyId
string	
Required if propertyType is CUSTOM

The id of the custom property. The property id is available from your company's custom properties page. Note that this call performs no checks as to whether the custom property value is valid, so invalid property values may be recorded.

value
A Color if the propertyType is APPEARANCE, a Material if it is MATERIAL, a boolean if it is EXCLUDE_FROM_BOM, a value with mass units if it is MASS_OVERRIDE, and a string otherwise. The value should be a string for a CUSTOM property even if the property is of a non-string type.

EXAMPLE

color(1, 0, 0) to make the part red.
getProperty (context is Context, definition is map)

NOTE: This function cannot be called on the current context inside custom features. It can only be called from table functions, editing logic, manipulator change functions, and custom features that refer to a different context. Getting properties in custom features within the current context is not possible, since features are regenerated before any user-set properties are applied.

Returns the value of a property of a single body, which can be either an Onshape property (allowed properties listed on PropertyType) or a custom property defined in company settings.

The returned value's type will correspond to the property type: A Color if the propertyType is APPEARANCE, a Material if it is MATERIAL, a boolean if it is EXCLUDE_FROM_BOM, and a string otherwise. CUSTOM property's returned value will always be a string, even if the custom property is of a non-string type.

Parameter	Type	Additional Info
definition	map	
entity
Query	
A single body the property applies to.

propertyType
PropertyType	
The property to get.

EXAMPLE

PropertyType.NAME to get the body's name
customPropertyId
string	
Required if propertyType is CUSTOM

The id of the custom property. The property id is available from your company's custom properties page.

Color type

Represents a color as red, green, blue, and alpha transparency components, each between 0 and 1 (inclusive).

canBeColor (value) predicate

Typecheck for Color

color (red is number, green is number, blue is number, alpha is number) returns Color

Create a Color from RGBA values, each between 0 and 1 (inclusive)

color (red is number, green is number, blue is number) returns Color

Create an opaque Color from RGB values, each between 0 and 1 (inclusive)

Material type

Represents a material.

canBeMaterial (value) predicate

Typecheck for Material

material (name is string, density is ValueWithUnits)

Constructs a material with a name and a density.

Parameter	Type	Additional Info
name	string	
The displayed name of the material.

density	ValueWithUnits	
EXAMPLE

19.3 * gram / centimeter ^ 3
sheetMetalFormedLibraryValidation
validate (context is Context) returns LibraryValidationProblems

Validates that a part studio can be part of a sheet metal form library

string
Pretty printing and toString methods

toString (value) returns string

Return a string representation of any value.

Overloads of this method are found for many standard and custom types in this and other modules. When overloaded, the toString method will be called inside print and println, allowing users to change how custom types are printed.

toString (value is string) returns string

toString (value is array) returns string

toString (value is map) returns string

print (value)

Print a message to the FeatureScript notices pane.

This has no effect on model state or rendering.

println (value)

Print a message to the FeatureScript notices pane, followed by a newline.

This has no effect on model state or rendering.

println ()

Print a newline to the FeatureScript notices pane.

splitIntoCharacters (s is string) returns array

Split a string into an array of characters, each represented as a string.

parseJson (s is string)

Parse a JSON string into either a map or array. Null values in the JSON are returned as undefined. Throws if the string is not well-formed JSON.

Return type	Description
A map or an array corresponding to the JSON value.

REGEX_NUMBER const

Matches a number in the string, with or without decimals or exponents.

REGEX_NUMBER_CAPTURE const

Matches a number in the string, with or without decimals or exponents and captures it.

addCustomNumberMatching (regExp is string) returns string

Extends regular expression syntax by adding \f to indicate a complete number

match (s is string, regExp is string) returns map

Test if s matches regExp in its entirety.

Return	Type	Description
map	
hasMatch
boolean	
true if regExp matches s

captures
array	
The first element is always the input string s. The following elements are a list of all captured groups.

replace (s is string, regExp is string, replacement is string) returns string

Returns a copy of s with every match of regExp replaced with the string replacement.

EXAMPLE

replace("a~~aa~a", "a.", "X") returns X~X~a
stringToNumber (s is string) returns number

Convert a number in string form, into a FS number. Note that this function will not accept trailing non numeric text, the entire string must be a single valid number.

EXAMPLE

stringToNumber("1") returns the number 1
EXAMPLE

stringToNumber("1.0") returns the number 1
EXAMPLE

stringToNumber("1e2") returns the number 100
length (s is string) returns number

Return the number of characters in a string.

substring (s is string, startIndex is number) returns string

Return a substring of a string starting at the specified start index.

EXAMPLE

substring("refactoring", 7) returns "ring"
substring (s is string, startIndex is number, endIndex is number) returns string

Return a substring of a string starting at the specified start index and ending at the specified end index.

EXAMPLE

substring("refactoring", 2, 6) returns "fact"
startsWith (s is string, prefix is string) returns boolean

Return whether a string starts with the specified prefix.

endsWith (s is string, suffix is string) returns boolean

Return whether a string ends with the specified suffix.

splitByRegexp (s is string, separatorRegexp is string) returns array

Split a string into parts based on a regular expression separator.

EXAMPLE

splitByRegexp("this, truly, is a test.", "[,. ]+") returns [ "this" , "truly" , "is" , "a" , "test" ]
EXAMPLE

splitByRegexp("fooooobazzoo", "oo") returns [ "f" , "" , "obazz" ]
EXAMPLE

splitByRegex("foo", "") returns [ "" , "" , "" , "" ]
indexOf (s is string, substr is string) returns number

Return the index of a substring in a string, or -1 if the substring is not found.

indexOf (s is string, substr is string, startIndex is number) returns number

Return the index of a substring in a string starting the search at a specified start index, or -1 if the substring is not found.

indexOfRegexp (s is string, regexp is string) returns number

Return the first index of a regular expression match in a string, or -1 if not found.

indexOfRegexp (s is string, regexp is string, startIndex is number) returns number

Return the first index of a regular expression match in a string starting at the specified start index, or -1 if not found.

repeatString (s is string, count is number) returns string

Return a string made by repeating the first argument a specified number of times. For example: repeatString("foo", 5) returns "foofoofoofoofoo".

isUndefinedOrEmptyString (val) predicate

Is undefined or empty string.

join (arr is array, separator is string) returns string

Concatenates all elements in an array into a string, delimited by a separator string.

join (arr is array) returns string

Concatenates all elements in an array into a string.

tabReferences
PartStudioData type

The value of a Part Studio reference parameter, specifying user-selected parts or other bodies from another Part Studio. The bodies can be added to the current context using an Instantiator.

Full documentation and examples uses can be found here.

See also

addInstance(Instantiator, PartStudioData, map)

Value	Type	Description
PartStudioData	map	
buildFunction
BuildFunction	
A function with one argument (a configuration map) which returns a new context containing all parts of the referenced Part Studio.

configuration
map	
The user-input values for the configuration of the selected Part Studio. The keys of this map are the configuration inputs' FeatureScript ids, and the map can be passed (either as-is or modified) into the buildFunction above, or to addInstance.

partQuery
Query	
A query for the user-selected parts in the other context.

configurationData
map	
This maps configuration input FeatureScript ids to maps that have information about the configuration inputs. Each of these maps has a defaultValue field with the default value of the configuration input. Enum configuration inputs (configuration lists) also have an options field with the value of the Enum.

ImageData type

The value of an image reference parameter, which can be placed in a Part Studio using skImage. Outside of use with skImage, color data for individual pixels is not accessable from FeatureScript.

Full documentation and example uses can be found here.

Value	Type	Description
ImageData	map	
imageWidth
number	
Width of the image, in pixels

imageHeight
number	
Height of the image, in pixels

mediaType
string	
MIME type of the uploaded image

TableData type

The value of a CSV reference parameter, containing the file's tabular data as an array of arrays.

Full documentation and example uses can be found here.

Value	Type	Description
TableData	map	
csvData
array	
If the CSV contains a single rows, this value is a single array of strings or numbers. If the value contains multiple rows, this value is an array of arrays of strings or numbers. Individual cell values can be accessed by indexing into these arrays (var row1column2 = definition.myTable.csvData[0][1]), or by iterating through them (for (var row in definition.myTable.csvData) { println(row); }).

JSONData type

The value of a JSON reference parameter, containing the file's data.

Value	Type	Description
JSONData	map	
jsonData
A value that represents the top-level entity of the imported JSON file: this is a map if the JSON entity is an object, an array if the JSON entity is an array, and likewise for the standard JSON types. Note that JSON null values are imported as undefined.

TextData type

The value of a Text reference parameter, containing the file's data.

Value	Type	Description
TextData	map	
textData
string	
A value that represents the top-level entity of the imported text file.

CADImportData type

The value of a CAD import reference parameter, which can be used by a Part Studio import feature. The data is not accessible outside of an import operation.

Full documentation and example can be found here.

table
defineTable (table is function) returns function

This function takes a table generation function and wraps it to define a table. It is analogous to defineFeature, except for tables. A typical usage is something like:

annotation { "Table Type Name" : "MyTable" } // This annotation is required for Onshape to recognize myTable as a table.
export const myTable = defineTable(function(context is Context, definition is map) returns Table
    precondition
    {
        ... // Specify the parameters that this table takes, if any
    }
    {
        ... // Compute and return the table, using the context and the parameters
    });
For more information on writing tables, see FeatureScript Tables (TODO) in the language guide.

Parameter	Type	Additional Info
table	function	
A function that takes a context and a definition and returns a Table or a TableArray

Table type

A Table represents a read-only table, consisting of rows, columns, and associated entities. Custom tables return a Table or an array of Tables (tagged as a TableArray) as their output.

The user-visible strings in a table, like column headings and cell values can be specified as either a string, a number, a ValueWithUnits or a TemplateString. These are referred to as "table values" and checked by the isTableValue predicate.

Value	Type	Description
Table	map	
title
A table value specifying the title of the table

columnDefinitions
array	
An array of TableColumnDefinitions specifying the columns.

rows
array	
An array of TableRows specifying the data in the table.

entities
Query	
Optional

An optional Query specifying the entities associated with the entire table.

canBeTable (value) predicate

Typecheck for Table

table (title, columnDefinitions is array, rows is array) returns Table

Constructs a Table given a title, column definitions, and rows

TableColumnDefinition type

A TableColumnDefinition represents a column in a Table.

Value	Type	Description
TableColumnDefinition	map	
id
string	
The internal id of the column. Referenced in TableRows to specify cell values.

name
A table value specifying the column name, which is displayed as the heading

alignment
TableTextAlignment	
Optional

How text is aligned in the column. Default is LEFT.

entities
Query	
Optional

An optional Query specifying the entities associated with the column.

canBeTableColumnDefinition (value) predicate

Typecheck for TableColumnDefinition

tableColumnDefinition (id is string, name) returns TableColumnDefinition

Constructs a TableColumnDefinition given an id and a name.

tableColumnDefinition (id is string, name, alignment is TableTextAlignment) returns TableColumnDefinition

Constructs a TableColumnDefinition given an id, a name, and a TableTextAlignment controlling how its cell content is aligned.

tableColumnDefinition (id is string, name, entities is Query) returns TableColumnDefinition

Constructs a TableColumnDefinition given an id, a name, and entities to cross-highlight when mousing over the column.

TableRow type

A TableRow represents a row in a table, including the cells in that row.

Value	Type	Description
TableRow	map	
columnIdToCell
map	
The cell values. Keys are column ids, as specified in the table column definitions. Values are table values or TableCellErrors.

entities
Query	
Optional

An optional Query specifying the entities associated with the row.

canBeTableRow (value) predicate

Typecheck for TableRow

tableRow (columnIdToCell is map) returns TableRow

Constructs a TableRow given the cell values.

tableRow (columnIdToCell is map, entities is Query) returns TableRow

Constructs a TableRow given the cell values and entities.

isTableValue (value) predicate

Returns true if the input is a table value, that is a string, a number, a ValueWithUnits or a TemplateString.

TableArray type

Represents an array of Tables. One possible output of a table function, the other being Table.

canBeTableArray (value) predicate

Typecheck for TableArray

tableArray (value is array) returns TableArray

Constructs a TableArray given an array.

TableCellError type

A TableCellError represents a table cell in an error state. Such a cell has a displayed value as well as an error message that appears as a tooltip over the cell.

Value	Type	Description
TableCellError	map	
value
The displayed value, provided as a table value.

error
The error message, provided as a table value.

canBeTableCellError (value) predicate

Typecheck for TableCellError.

tableCellError (value, error) returns TableCellError

Constructs a TableCellError given a displayed value and an error message.

TableCellWithInfo type

A TableCellWithInfo represents a table cell with both a value and an info message. Such a cell has a displayed value as well an info icon and a message that appears as a tooltip over the info icon.

Value	Type	Description
TableCellWithInfo	map	
value
The displayed value, provided as a table value.

info
The info message, provided as a table value.

canBeTableCellWithInfo (value) predicate

Typecheck for TableCellWithInfo.

tableCellWithInfo (value, info) returns TableCellWithInfo

Constructs a TableCellWithInfo given a displayed value and an info message.

StringToleranceComponent type

Represents a component with an inline part followed by stacked upper and lower components.

Value	Type	Description
StringToleranceComponent	map	
value
A value to be displayed as a regular row of text.

upper
The upper component of the tolerance.

lower
The lower component of the tolerance.

stringToleranceComponent (value is map) returns StringToleranceComponent

Constructor for StringToleranceComponent

StringWithTolerances type

Represents a compound string which may contain toleranced components.

Value	Type	Description
StringWithTolerances	map	
components
An array of either strings, TemplateStrings, or StringToleranceComponents.

stringWithTolerances (value is map)

Constructor for StringWithTolerances

toString (value is StringToleranceComponent) returns string

toString (value is StringWithTolerances) returns string

concatenateStringsWithTolerances (a is StringWithTolerances, b is StringWithTolerances) returns StringWithTolerances

Concantenates two StringWithTolerances values together.

appendToleranceComponent (result is StringWithTolerances, component) returns StringWithTolerances

Appends either a string, a TemplateString, or a StringToleranceComponent to an existing StringWithTolerances.

createStringWithTolerances (component) returns StringWithTolerances

Creates a StringWithTolerances wrapping the specified component.

tolerancedValueToString (prefix is string, value is ValueWithUnits, tolerance) returns StringWithTolerances

Converts a ValueWithUnits and an associated ToleranceInfo into a StringWithTolerances.

allSolidsAndClosedComposites (context is Context) returns array

Returns an array of maps for all modifiable non-mesh solids and closed composites. Each map has a key part, which maps to a query for the solid or composite and bodies, which maps to either the solid or all constituent bodies. This is useful for iterating over what a user may consider to be "individual parts" in a context.

EXAMPLE

for (var partAndBodies in allSolidsAndClosedComposites(context))
{
    var name = getProperty(context, { "entity" : partAndBodies.part, "propertyType" : PropertyType.NAME } );
    var volume = evVolume(context, { "entities" : partAndBodies.bodies });
}
toString (table is Table) returns string

Tries to convert a table to string form. Because the actual table output depends on user-chosen units and precision, the result of this function may not match it.

toString (value is TemplateString) returns string

templatestring
ValueWithUnitsAndPrecision type

Represents a ValueWithUnits which, when put in a TemplateString will render with a specified precision override.

canBeValueWithUnitsAndPrecision (value) predicate

Typecheck for ValueWithUnitsAndPrecision

valueWithUnitsAndPrecision (value is ValueWithUnits, precision is number) returns ValueWithUnitsAndPrecision

Constructs a ValueWithUnitsAndPrecision given the value and precision.

TemplateString type

A TemplateString represents a value that will be formatted by template substitution. It is useful when, for instance, a table cell needs to display some text in combination with a length formatted in the document length units.

The TemplateString is a map with a string field template. Other fields represent parameters to substitute and may be strings, numbers or ValueWithUnits.

Formatting happens as follows: Text in template that does not contain the number sign # is unchanged. #identifier (where identifier is a valid FeatureScript identifier) causes a substitution with the result of looking up identifier in the map. ## is changed to #. # (The number sign followed by a space) is removed, which can be useful for separating a substitution from text.

EXAMPLE

{ 'template' : 'Length = #len', 'len' : foot } gets formatted as Length = 12 in if document units are inches.
EXAMPLE

{ 'template' : '###var# bar', 'var' : 'foo' } get formatted as #foobar.
canBeTemplateString (value) predicate

Typecheck for TemplateString.

templateString (value is map) returns TemplateString

Constructor for TemplateString.

Parameter	Type	Additional Info
value	map	
A map with a "template" field and any number of other fields, which may be referenced in the template string as e.g. #myValue. Used in FeatureScript tables. See TemplateString docs for more info.

EXAMPLE

{ "template" : "Value of #myValue", "myValue" : 42 }
tolerance
defineLengthTolerance (definition is map, field is string, parentParameterName is string) predicate

Creates a parameter group containing length tolerance controls for the specified field in the specified definition.

defineLengthToleranceExtended (definition is map, field is string, parentParameterName is string) predicate

Creates a parameter group containing length fit tolerance controls for the specified field in the specified definition.

defineAngleTolerance (definition is map, field is string, parentParameterName is string) predicate

Creates a parameter group containing angle tolerance controls for the specified field in the specified definition.

getToleranceInfo (context is Context, definition is map, field is string, isAngle is boolean) returns ToleranceInfo

getToleranceInfo (definition is map, field is string) returns ToleranceInfo

Extracts the ToleranceInfo associated with a given field in the given feature definition. The ToleranceInfo is gathered from parameters which are created using either the defineLengthTolerance or defineAngleTolerance predicates.

updateFitToleranceFields (context is Context, id is Id, definition is map, field is string) returns map

Updates the fit tolerance field information associated with a specified field in the given feature definition. The tolerance information is extracted from parameters created using the defineLengthToleranceExtended predicates.

Parameter	Type	Additional Info
context	Context	
The target context.

id	Id	
Identifier of the feature.

definition	map	
The feature definition from which to extract and update tolerance information.

field	string	
The field name for which to update tolerance information.

Return type	Description
map	
The updated feature definition with updated tolerance information.

isToleranceSet (tolerance is ToleranceInfo) returns boolean

Determines whether or not a tolerance is set in a given ToleranceInfo. A tolerance is considered to be "set" if either its tolerance type is set to a value other than NONE, or if it has a precision override value set.

isToleranceInfoOrUndefined (val) predicate

Determines if a given value is either a ToleranceInfo or undefined.

getToleranceBounds (nominal is ValueWithUnits, tolerance is ToleranceInfo, options is map) returns array

Produces an array containing the upper and lower bounds of a ValueWithUnits given a specified ToleranceInfo as well as a map of options.

Parameter	Type	Additional Info
nominal	ValueWithUnits	
the nominal value

tolerance	ToleranceInfo	
the tolerance info for the given value

options	map	
minimum
ValueWithUnits	
the upper bound if the tolerance type is maximum

maximun
ValueWithUnits	
the lower bound if the tolerance type is minimum

useDrawingLimitsFix
boolean	
if false, uses the old bounds calculation of \[lowerLim, upperLim\]

getToleranceBounds (nominal is ValueWithUnits, tolerance, minimum is ValueWithUnits, maximum is ValueWithUnits) returns array

Produces an array containing the upper and lower bounds of a ValueWithUnits given a specified ToleranceInfo.

toleranceSchemaValidation
validate (context is Context) returns LibraryValidationProblems

Validates that a variable studio can be used to define a default tolerance library

toleranceTypes
ToleranceType enum

Defines the tolerance type of a hole feature's parameter.

Value	Description
NONE	
Defines no tolerance.

SYMMETRICAL	
Defines a tolerance type where the allowed tolerance is a symmetrical deviation.

DEVIATION	
Defines a tolerance type where the allowed tolerance is an asymmetrical deviation.

LIMITS	
Defines a tolerance type where the allowed tolerance has defined upper and lower limits.

MIN	
Defines a tolerance type where the parameter's value is considered the minimum allowed value.

MAX	
Defines a tolerance type where the parameter's value is considered the maximum allowed value.

FIT	
FIT_WITH_TOLERANCE	
FIT_TOLERANCE_ONLY	
DEFAULT	
BASIC	
ToleranceTypeExtended enum

Defines the tolerance type of a hole feature's parameter.

Value	Description
NONE	
Defines no tolerance.

SYMMETRICAL	
Defines a tolerance type where the allowed tolerance is a symmetrical deviation.

DEVIATION	
Defines a tolerance type where the allowed tolerance is an asymmetrical deviation.

LIMITS	
Defines a tolerance type where the allowed tolerance has defined upper and lower limits.

MIN	
Defines a tolerance type where the parameter's value is considered the minimum allowed value.

MAX	
Defines a tolerance type where the parameter's value is considered the maximum allowed value.

FIT	
Defines a tolerance type where the upper and lower limits are defined by the specified fit tolerance class.

FIT_WITH_TOLERANCE	
Defines a tolerance type where the upper and lower limits are defined by the specified fit tolerance class.

FIT_TOLERANCE_ONLY	
Defines a tolerance type where the upper and lower limits are defined by the specified fit tolerance class.

ToleranceInfo type

Stores tolerance-related info for a specific field in a feature. This info includes an optional precision override, a tolerance type, and, if applicable, an upper and lower bound associated with that tolerance type.

Upper and lower tolerances are differences from the nominal value and are both added to the nominal value.

EXAMPLE

// +/- 1mm
{
 toleranceType: ToleranceType.SYMMETRICAL,
 upper: 1 * millimeter,
 lower: -1 * millimeter
}
Tolerances need not be positive and negative. The only requirement is that the upper tolerance is greater than the lower.

EXAMPLE

// +0.1mm / +0.02mm
{
 toleranceType: ToleranceType.DEVIATION,
 upper: 0.1 * millimeter,
 lower: 0.02 * millimeter
}
See also

setDimensionedEntities

Value	Type	Description
ToleranceInfo	map	
usePrecisionOverride
boolean	
Optional

Whether a precision override is defined

precision
number	
Required if usePrecisionOverride is true

The number of decimal places output for the parameter's nominal value and tolerances

toleranceType
ToleranceType	
toleranceFitInfo
ToleranceFitInfo	
Required if toleranceType is FIT, FIT_WITH_TOLERANCE or FIT_TOLERANCE_ONLY

Specifies the fit standard to be used for a hole or shaft

upper
ValueWithUnits	
Required if toleranceType is SYMMETRICAL, DEVIATION or LIMITS

Specifies the upper tolerance.

lower
ValueWithUnits	
Required if toleranceType is SYMMETRICAL, DEVIATION or LIMITS

Specifies the lower tolerance.

canBeToleranceInfo (val) predicate

Type checking predicate for the ToleranceInfo type.

toleranceInfo (info is map)

Constructor for the ToleranceInfo type.

ToleranceFitInfo type

Stores fit tolerance-related info for a specific field in a feature.

See also

setDimensionedEntities , ToleranceInfo

Value	Type	Description
ToleranceFitInfo	map	
standard
string	
"ISO" or "ANSI"

holeClass
string	
The class of the hole

shaftClass
string	
Optional

The class of the shaft

canBeToleranceFitInfo (val) predicate

Type checking predicate for the ToleranceFitInfo type.

toleranceFitInfo (info is map)

Constructor for the ToleranceFitInfo type.

PrecisionType enum

Defines the precision of a tolerant quantity.

Value	Description
DEFAULT	
ONES	
Display precision up to '1'.

TENTHS	
Display precision up to '0.1'.

HUNDREDTHS	
Display precision up to '0.01'.

THOUSANDTHS	
Display precision up to '0.001'.

TEN_THOUSANDTHS	
Display precision up to '0.0001'.

HUNDRED_THOUSANDTHS	
Display precision up to '0.00001'.

MILLIONTHS	
Display precision up to '0.000001'.

topologyUtils
edgeIsTwoSided (context is Context, edge is Query) returns boolean

Returns true if edge has two adjacent faces, false if edge is a laminar or wire edge.

isClosed (context is Context, edge is Query) returns boolean

Returns true if edge is closed, false if edge is open

dissolveWires (edgesAndWires is Query) returns Query

Returns the union of any edges from the input query and all the edges of any body from the input query

followWireEdgesToLaminarSource (context is Context, query is Query) returns Query

If the query contains wire edges then this function will track the wire edges back through creation history to find laminar edges that the edge was copied from (or will return the original edge if none).

extractDirection (context is Context, entity is Query)

Extract a direction from an axis or a plane. Useful for processing query parameters with the QueryFilterCompound.ALLOWS_DIRECTION filter.

Return type	Description
a 3D unit Vector if a direction can be extracted, otherwise undefined.

connectedComponents (context is Context, entities is Query, adjacencyType is AdjacencyType) returns array

Find connected components in the topological graph of provided entities. Each component is a group of topologically connected entities, and each component is disjoint with (does not connect topologically with) any other component. Connectivity is tested using qAdjacent with the specified adjacencyType.

Returns an array of components. Each component is an array of individual queries. The queries in any component will respect the query evaluation order of the supplied entities Query. The components themselves will also be ordered by query evaluation order, sorted by the first entity in each component.

Unlike constructPath, this function operates on topological connections (underlying connections by a vertex or edge). Distinct bodies are not topologically connected, so even if two entities on distinct bodies are geometrically related by having a coincident vertex or edge, the entities connected to these coincident vertices or edges will fall into different components. Sketch edges are each represented as a distinct wire body, and are not topologically connected, so this method cannot be used for them.

groupEntitiesByBody (context is Context, entities is Query) returns map

Group entities by their owner body.

Return type	Description
map	
a map from the transient query for an individual body to an array of transient queries for the individual entities which belong to that body.

sweptAlong (context is Context, face is Query, direction is Vector) returns boolean

Check whether a face is swept along a specified direction.

clusterBodies (context is Context, definition is map) returns array

Groups bodies into clusters of identical topology and identical geometry (up to a relative tolerance), allowing arbitrary 3D rotations (but not reflection).

Parameter	Type	Additional Info
definition	map	
bodies
Query	
The bodies to cluster

relativeTolerance
number	
A tolerance, expressed as a decimal value, to compare bodies with.

EXAMPLE

0.01 to cluster bodies that have a 1% similarity
Return type	Description
array	
an array of clusters, where each cluster is an array of indices into the result of evaluating bodies.

valueBounds
Value bounds are used to define minimum, maximum, and default values for numbers and values with units. These bounds are in the feature dialog UI for parameters with the given bounds.

In standard usage, a parameter can be specified with e.g. angle bounds in a feature precondition as follows:

isAngle(definition.myAngle, ANGLE_360_BOUNDS);
To change the bounds and defaults on the above declaration, a user may replace ANGLE_360_BOUNDS with another AngleBoundSpec in this module, or define their own. For instance, the following code creates a parameter whose default value is 45 degrees (if the user's settings have degrees as the default) or 1 radian (if the user's settings have radians as the default).

const MY_BOUNDS =
{
    (degree) : [0, 45, 360],
    (radian) : 1
} as AngleBoundSpec;
...
    isAngle(definition.myAngle, MY_BOUNDS);
...
isLength (value, boundSpec is LengthBoundSpec) predicate

True for a value with length units which conforms to the given bounds.

Used in feature preconditions to specify a length parameter.

Parameter	Type	Additional Info
boundSpec	LengthBoundSpec	
Specifies a min, a max, and a default value. These values are possibly different in different units for the sake of round numbers.

To specify a parameter with different default value or different limits, use a different or custom LengthBoundSpec.

isAngle (value, boundSpec is AngleBoundSpec) predicate

True for a value with angle units which conforms to the given bounds.

Used in feature preconditions to specify an angle parameter.

Parameter	Type	Additional Info
boundSpec	AngleBoundSpec	
Specifies a min, a max, and a default value. These values are possibly different in different units for the sake of round numbers.

To specify a parameter with different default value or different limits, use a different or custom AngleBoundSpec.

isInteger (value, boundSpec is IntegerBoundSpec) predicate

True for a number that is an integer and conforms to the given bounds.

Used in feature preconditions to specify an integer or count parameter.

Parameter	Type	Additional Info
boundSpec	IntegerBoundSpec	
Specifies a min, a max, and a default value. These values are possibly different in different units for the sake of round numbers.

To specify a parameter with different default value or different limits, use a different or custom IntegerBoundSpec.

isReal (value, boundSpec is RealBoundSpec) predicate

True for a real number which conforms to the given bounds.

Used in feature preconditions to specify a unitless numeric parameter.

Parameter	Type	Additional Info
boundSpec	RealBoundSpec	
Specifies a min, a max, and a default value. These values are possibly different in different units for the sake of round numbers.

To specify a parameter with different default value or different limits, use a different or custom RealBoundSpec.

LENGTH_BOUNDS const

A LengthBoundSpec for a positive or negative length.

NONNEGATIVE_LENGTH_BOUNDS const

A LengthBoundSpec for a length strictly greater than 0.

NONNEGATIVE_ZERO_INCLUSIVE_LENGTH_BOUNDS const

A LengthBoundSpec for a length greater than or equal to 0.

NONNEGATIVE_ZERO_DEFAULT_LENGTH_BOUNDS const

A LengthBoundSpec for a length greater than or equal to 0, with UI defaults of 0.0 for all units.

NONPOSITIVE_ZERO_DEFAULT_LENGTH_BOUNDS const

A LengthBoundSpec for a length less than or equal to 0, with UI defaults of 0.0 for all units.

ZERO_DEFAULT_LENGTH_BOUNDS const

A LengthBoundSpec for a positive or negative length, with UI defaults of 0.0 for all units.

BLEND_BOUNDS const

A LengthBoundSpec for fillets and chamfers, with smaller defaults than NONNEGATIVE_LENGTH_BOUNDS (0.2 * inch, etc.).

SHELL_OFFSET_BOUNDS const

A LengthBoundSpec for a shell or offset thickness, with smaller defaults than NONNEGATIVE_LENGTH_BOUNDS. (0.1 * inch, etc.).

ZERO_INCLUSIVE_OFFSET_BOUNDS const

A LengthBoundSpec for an offset thickness, for a length greater than or equal to 0, with defaults greater than NONNEGATIVE_ZERO_INCLUSIVE_LENGTH_BOUNDS

ANGLE_360_BOUNDS const

An AngleBoundSpec for an angle between 0 and 360 degrees, defaulting to 30 degrees.

ANGLE_360_REVERSE_DEFAULT_BOUNDS const

An AngleBoundSpec for an angle between 0 and 360 degrees, defaulting to 330 degrees.

ANGLE_360_ZERO_DEFAULT_BOUNDS const

An AngleBoundSpec for an angle between 0 and 360 degrees, defaulting to 0 degrees.

ANGLE_360_FULL_DEFAULT_BOUNDS const

An AngleBoundSpec for an angle between 0 and 360 degrees, defaulting to 360 degrees.

ANGLE_360_90_DEFAULT_BOUNDS const

An AngleBoundSpec for an angle between 0 and 360 degrees, defaulting to 90 degrees.

ANGLE_STRICT_180_BOUNDS const

An AngleBoundSpec for an angle strictly less than 180 degrees.

ANGLE_STRICT_90_BOUNDS const

An AngleBoundSpec for an angle strictly less than 90 degrees.

ANGLE_180_MINUS_180_BOUNDS const

An AngleBoundSpec for an angle between -180 and 180 degrees, defaulting to 0 degrees.

NONPOSITIVE_ZERO_DEFAULT_ANGLE_BOUNDS const

AnAngleBoundSpec for an angle less than or equal to 0, with UI defaults of 0.0 for all units.

NONNEGATIVE_ZERO_DEFAULT_ANGLE_BOUNDS const

An AngleBoundSpec for an angle greater than or equal to 0, with UI defaults of 0.0 for all units.

POSITIVE_COUNT_BOUNDS const

An IntegerBoundSpec for an integer strictly greater than zero, defaulting to 2.

POSITIVE_REAL_BOUNDS const

A RealBoundSpec for a number greater than or equal to zero, defaulting to 1.

SCALE_BOUNDS const

A RealBoundSpec for the positive or negative scale factor on a transform, defaulting to 1.

LengthBoundSpec type

A spec to be used with the isLength predicate to define allowable lengths and customize UI behaviors for feature dialog parameters that take in a length.

A typical declaration looks like:

const MY_LENGTH_BOUNDS =
{
    (meter)      : [-500, 0.0025, 500],
    (centimeter) : .25,
    (millimeter) : 2.50,
    (inch)       : 0.1,
    (foot)       : 0.01,
    (yard)       : 0.0025
} as LengthBoundSpec;
The values for (meter), (inch), etc. define the bounds and default values for a feature parameter defined with MY_LENGTH_BOUNDS. The default values will be different for users who have set different default units.

Specifically, the first unit listed specified defines the minimum value, default value, and the maximum value (in terms of that unit) and the subsequent units define default values for those units, when a user with those default units first opens the dialog. The default value for a unit that is not listed is the default value of the first unit so { (inch) : [0, 1, 1e4] } as LengthBoundSpec will give a default of 2.54 cm in a Part Studio with centimeter units

canBeLengthBoundSpec (value) predicate

Typecheck for LengthBoundSpec

AngleBoundSpec type

A spec to be used with the isAngle predicate to define allowable angles and customize UI behaviors for feature dialog parameters that take in an angle.

A typical declaration looks like:

const ANGLE_360_BOUNDS =
{
    (degree) : [0, 30, 360],
    (radian) : 1
} as AngleBoundSpec;
For more information on what the various fields signify, see LengthBoundSpec.

canBeAngleBoundSpec (value) predicate

Typecheck for AngleBoundSpec

IntegerBoundSpec type

A spec to be used with the isInteger predicate to define allowable numbers and customize UI behaviors for feature dialog parameters that take in a number.

A typical declaration looks like:

const POSITIVE_COUNT_BOUNDS =
{
    (unitless) : [1, 2, 1e5]
} as IntegerBoundSpec;
For more information on what the various fields signify, see LengthBoundSpec.

canBeIntegerBoundSpec (value) predicate

Typecheck for IntegerBoundSpec

RealBoundSpec type

A spec to be used with the isReal predicate to define allowable real numbers and customize UI behaviors for feature dialog parameters that take in a real number.

A typical declaration looks like:

const POSITIVE_REAL_BOUNDS =
{
    (unitless) : [0, 1, 1e5]
} as RealBoundSpec;
For more information on what the various fields signify, see LengthBoundSpec.

canBeRealBoundSpec (value) predicate

Typecheck for RealBoundSpec

SWEEP_PITCH_BOUNDS const

A LengthBoundSpec for a sweep pitch. (0.1 * inch, etc.).

SWEEP_TURNS_BOUNDS const

A RealBoundSpec for a sweep turns.

SWEEP_ANGLE_BOUNDS const

An AngleBoundSpec for sweep twist angles.

wrapSurface
WrapSurface type

Represents the source or destination surface for opWrap. Exactly one of face, plane, cylinder, or cone must be defined.

(Formerly RollSurface)

Value	Type	Description
WrapSurface	map	
face
Query	
The face entity defining this WrapSurface.

plane
Plane	
The plane geometry defining this WrapSurface.

cylinder
Cylinder	
The cylinder geometry defining this WrapSurface.

cone
Cone	
The cone geometry defining this WrapSurface.

anchorPoint
Vector	
The anchor point of the WrapSurface, used to align the source and destination WrapSurfaces for opWrap. Must lie on the WrapSurface. If this condition is not met, opWrap will fail.

anchorDirection
Vector	
The anchor direction of the WrapSurface, used to align the source and destination WrapSurfaces for opWrap. Must lie on the tangent plane of the WrapSurface at the anchorPoint. If this condition is not met, opWrap will fail.

isWrapPlane (context is Context, val is WrapSurface) predicate

Returns whether the given WrapSurface is a plane.

Parameter	Type	Additional Info
val	WrapSurface	
The WrapSurface to check.

isWrapCylinder (context is Context, val is WrapSurface) predicate

Returns whether the given WrapSurface is a cylinder.

Parameter	Type	Additional Info
val	WrapSurface	
The WrapSurface to check.

isWrapCone (context is Context, val is WrapSurface) predicate

Returns whether the given WrapSurface is a cone.

Parameter	Type	Additional Info
val	WrapSurface	
The WrapSurface to check.

makeWrapSurface (context is Context, face is Query) returns WrapSurface

Make a WrapSurface for opWrap defined by a planar or cylindrical face.

Parameter	Type	Additional Info
face	Query	
A face to use as the definition face for the WrapSurface. For a planar face: The plane origin will be used as the anchorPoint and the plane x direction will be used as the anchorDirection. For a cylindrical face: The point at which the cylinder's coordSystem's positive xAxis intersects the cylinder will be used as the anchorPoint. The cylinder's yAxis will be used as the anchorDirection. See WrapSurface documentation for descriptions of anchorPoint and anchorDirection.

makeWrapSurface (context is Context, face is Query, anchorPoint is Vector, spin is ValueWithUnits) returns WrapSurface

Make a WrapSurface for opWrap defined by a planar, cylindrical or conical face.

Parameter	Type	Additional Info
face	Query	
A face to use as the definition face for the WrapSurface.

anchorPoint	Vector	
The anchor point of the WrapSurface. See WrapSurface documentation.

spin	ValueWithUnits	
For a planar face: Angle of a counter-clockwise spin to apply to the plane's x axis about its positive z axis, which is then used as the anchorDirection. For a cylindrical face: Angle of a counter-clockwise spin to apply to the cylinder's canonical anchorDirection at the given anchorPoint about the direction vector from the cylinder axis to the anchorPoint. The canonical anchorDirection at the given anchorPoint is defined as the "rightward" direction when looking at the cylinder in the direction from the anchorPoint to the cylinder axis with the cylinder's zAxis up. In other words: cross(cylinder z axis, direction vector from cylinder axis to anchorPoint). This spun direction is then used as the anchorDirection. For a conical face: Angle of a counter-clockwise spin to apply to the cone's canonical anchorDirection at the given anchorPoint about the normal at anchorPoint. The canonical anchorDirection at the given anchorPoint is defined as the "rightward" direction when looking at the cone from the normal.

See WrapSurface documentation for a description of anchorDirection.

makeWrapSurface (context is Context, face is Query, anchorPoint is Vector, anchorDirection is Vector) returns WrapSurface

Make a WrapSurface for opWrap defined by a planar, cylindrical or conical face.

Parameter	Type	Additional Info
face	Query	
A face to use as the definition face for the WrapSurface.

anchorPoint	Vector	
The anchor point of the WrapSurface. See WrapSurface documentation.

anchorDirection	Vector	
The anchor direction of the WrapSurface. See WrapSurface documentation.

makeWrapPlane (plane is Plane) returns WrapSurface

Make a WrapSurface for opWrap from a Plane.

Parameter	Type	Additional Info
plane	Plane	
The definition plane for the WrapSurface. The plane origin will be used as the anchorPoint and the plane x direction will be used as the anchorDirection. See WrapSurface documentation for descriptions of anchorPoint and anchorDirection.

makeWrapPlane (plane is Plane, anchorPoint is Vector, spin is ValueWithUnits) returns WrapSurface

Make a WrapSurface for opWrap from a Plane.

Parameter	Type	Additional Info
plane	Plane	
The definition plane for the WrapSurface.

anchorPoint	Vector	
The anchor point of the WrapSurface. See WrapSurface documentation.

spin	ValueWithUnits	
Angle of a counter-clockwise spin to apply to the plane's x axis about its positive z axis, which is then used as the anchorDirection. See WrapSurface documentation for a description of anchorDirection.

makeWrapPlane (plane is Plane, anchorPoint is Vector, anchorDirection is Vector) returns WrapSurface

Make a WrapSurface for opWrap from a Plane.

Parameter	Type	Additional Info
plane	Plane	
The definition plane for the WrapSurface.

anchorPoint	Vector	
The anchor point of the WrapSurface. See WrapSurface documentation.

anchorDirection	Vector	
The anchor direction of the WrapSurface. See WrapSurface documentation.

makeWrapPlane (context is Context, planarFace is Query, anchorPoint is Vector, anchorDirection is Vector) returns WrapSurface

Make a WrapSurface for opWrap from a planar face.

Parameter	Type	Additional Info
planarFace	Query	
A planar face to use as the definition plane for the WrapSurface.

anchorPoint	Vector	
The anchor point of the WrapSurface. See WrapSurface documentation.

anchorDirection	Vector	
The anchor direction of the WrapSurface. See WrapSurface documentation.

flipWrapPlane (wrapPlane is WrapSurface) returns WrapSurface

Flip the normal direction of the Plane described by this WrapSurface. Do not change the anchorPoint or anchorDirection.

makeWrapCylinder (cylinder is Cylinder) returns WrapSurface

Make a WrapSurface for opWrap from a Cylinder.

Parameter	Type	Additional Info
cylinder	Cylinder	
The definition cylinder for the WrapSurface. The point at which the cylinder's coordSystem's positive xAxis intersects the cylinder will be used as the anchorPoint. The cylinder's yAxis will be used as the anchorDirection. See WrapSurface documentation for descriptions of anchorPoint and anchorDirection.

makeWrapCylinder (cylinder is Cylinder, anchorPoint is Vector, spin is ValueWithUnits) returns WrapSurface

Make a WrapSurface for opWrap from a Cylinder.

Parameter	Type	Additional Info
cylinder	Cylinder	
The definition cylinder for the WrapSurface.

anchorPoint	Vector	
The anchor point of the WrapSurface. See WrapSurface documentation.

spin	ValueWithUnits	
Angle of a counter-clockwise spin to apply to the cylinder's canonical anchorDirection at the given anchorPoint about the direction vector from the cylinder axis to the anchorPoint. The canonical anchorDirection at the given anchorPoint is defined as the "rightward" direction when looking at the cylinder in the direction from the anchorPoint to the cylinder axis with the cylinder's zAxis up. In other words: cross(cylinder z axis, direction vector from cylinder axis to anchorPoint). This spun direction is then used as the anchorDirection. See WrapSurface documentation for a description of anchorDirection.

makeWrapCylinder (cylinder is Cylinder, anchorPoint is Vector, anchorDirection is Vector) returns WrapSurface

Make a WrapSurface for opWrap from a Cylinder.

Parameter	Type	Additional Info
cylinder	Cylinder	
The definition cylinder for the WrapSurface.

anchorPoint	Vector	
The anchor point of the WrapSurface. See WrapSurface documentation.

anchorDirection	Vector	
The anchor direction of the WrapSurface. See WrapSurface documentation.

makeWrapCylinder (context is Context, cylindricalFace is Query, anchorPoint is Vector, anchorDirection is Vector) returns WrapSurface

Make a WrapSurface for opWrap from a cylindrical face.

Parameter	Type	Additional Info
cylindricalFace	Query	
A cylindrical face to use as the definition cylinder for the WrapSurface.

anchorPoint	Vector	
The anchor point of the WrapSurface. See WrapSurface documentation.

anchorDirection	Vector	
The anchor direction of the WrapSurface. See WrapSurface documentation.

makeWrapCone (cone is Cone, anchorPoint is Vector, spin is ValueWithUnits) returns WrapSurface

Make a WrapSurface for opWrap from a Cone.

Parameter	Type	Additional Info
cone	Cone	
The definition cone for the WrapSurface.

anchorPoint	Vector	
The anchor point of the WrapSurface. See WrapSurface documentation.

spin	ValueWithUnits	
Angle of a counter-clockwise spin to apply to the cone's canonical anchorDirection at the given anchorPoint about the normal at the anchorPoint. This spun direction is then used as the anchorDirection. See WrapSurface documentation for a description of anchorDirection.

makeWrapCone (cone is Cone, anchorPoint is Vector, anchorDirection is Vector) returns WrapSurface

Make a WrapSurface for opWrap from a Cone.

Parameter	Type	Additional Info
cone	Cone	
The definition cone for the WrapSurface.

anchorPoint	Vector	
The anchor point of the WrapSurface. See WrapSurface documentation.

anchorDirection	Vector	
The anchor direction of the WrapSurface. See WrapSurface documentation.

makeWrapCone (context is Context, conicalFace is Query, anchorPoint is Vector, anchorDirection is Vector) returns WrapSurface

Make a WrapSurface for opWrap from a conical face.

Parameter	Type	Additional Info
conicalFace	Query	
A conical face to use as the definition cone for the WrapSurface.

anchorPoint	Vector	
The anchor point of the WrapSurface. See WrapSurface documentation.

anchorDirection	Vector	
The anchor direction of the WrapSurface. See WrapSurface documentation.

Onshape features
bodyDraft
bodyDraft (context is Context, id is Id, definition is map)

An operation that performs an opBodyDraft.

bodyDraftEditLogic (context is Context, id is Id, oldDefinition is map, definition is map, isCreating is boolean, specifiedParameters is map) returns map

body draft editing logic

boolean
booleanBodies (context is Context, id is Id, definition is map)

The boolean feature. Performs an opBoolean after a possible opOffsetFace if the operation is subtraction.

convertNewBodyOpToBoolOp (operationType is NewBodyOperationType) returns BooleanOperationType

Maps a NewBodyOperationType (used in features like extrude) to its corresponding BooleanOperationType.

booleanStepTypePredicate (booleanDefinition is map) predicate

Predicate which specifies a field operationType of type NewBodyOperationType. Used by body-creating feature preconditions such as extrude, revolve, sweep or loft.

When used in a precondition, NewBodyOperationType creates UI like the extrude feature, with a horizontal list of the words "New", "Add", etc. When using this predicate in features, make sure to export an import of tool.fs so that NewBodyOperationType is visible to the Part Studios:

export import(path : "onshape/std/tool.fs", version : "");
booleanStepScopePredicate (booleanDefinition is map) predicate

Used by body-creating feature preconditions to allow post-creation booleans, specifying the merge scope (or "Merge with all") for that boolean.

Designed to be used together with booleanStepTypePredicate.

booleanPatternScopePredicate (booleanDefinition is map) predicate

Used by body-creating pattern feature preconditions to allow post-creation booleans with surfaces or solids, specifying the merge scope (or "Merge with all") for that boolean.

processNewBodyIfNeeded (context is Context, id is Id, definition is map, reconstructOp is function)

This function is designed to be used by body-creating features (like extrude) as a boolean post-processing step with options from booleanStepTypePredicate and booleanStepScopePredicate in the case where the preceding operations of the feature have created new solid or surface bodies. On top of the regular boolean operation, converts the operationType and creates error bodies on failure.

Parameter	Type	Additional Info
id	Id	
identifier of the main feature

definition	map	
operationType
NewBodyOperationType	
EXAMPLE

NewBodyOperationType.ADD performs a boolean union
EXAMPLE

NewBodyOperationType.NEW does nothing
defaultScope
boolean	
Optional

EXAMPLE

true indicates merge scope of "everything else" (default)
EXAMPLE

false indicates merge scope is specified in booleanScope
booleanScope
Query	
targets to use if defaultScope is false

seed
Query	
Optional

If set, will be included in the tools section of the boolean.

mergeScopeExclusion
Query	
Optional

If set, will be excluded from the targets section of the boolean.

reconstructOp	function	
A function which takes in an Id, and reconstructs the input to show to the user as error geometry in case the input is problematic or the boolean itself fails.

EXAMPLE

function() {} . For a more elaborate example see the source code of revolve feature in the Standard Library.
surfaceOperationTypePredicate (surfaceDefinition is map) predicate

Predicate which specifies a field surfaceOperationType of type NewSurfaceOperationType. Used by surface-creating feature preconditions such as revolve, sweep or loft.

When used in a precondition, NewSurfaceOperationType creates UI like the sweep feature, with a horizontal list of the words "New" and "Add". When using this predicate in features, make sure to export an import of tool.fs so that NewSurfaceOperationType is visible to the Part Studios:

export import(path : "onshape/std/tool.fs", version : "");
surfaceJoinStepScopePredicate (definition is map) predicate

Used by surface-creating feature preconditions to allow post-creation booleans, specifying the merge scope (or "Merge with all") for that boolean.

Designed to be used together with surfaceOperationTypePredicate.

joinSurfaceBodiesWithAutoMatching (context is Context, id is Id, definition is map, makeSolid is boolean, reconstructOp is function)

This function is designed to be used by surface-body-creating features (like extrude) as a boolean post-processing step with options from surfaceOperationTypePredicate and surfaceJoinStepScopePredicate. It detects matching edges of adjacent bodies and joins surface bodies at these edges.

Parameter	Type	Additional Info
id	Id	
identifier of the feature

definition	map	
defaultSurfaceScope
boolean	
Optional

EXAMPLE

true indicates merge scope of all the original and related surfaces used as input to create this surface (default)
EXAMPLE

false indicates merge scope is specified in booleanSurfaceScope
booleanSurfaceScope
Query	
Optional

targets to use if defaultSurfaceScope is false Default is qNothing()

seed
Query	
Optional

Default is qNothing() If set, will be included in the tools section of the boolean.

makeSolid	boolean	
Tries to join the surfaces into a solid

reconstructOp	function	
A function which takes in an Id, and reconstructs the input to show to the user as error geometry in case the input is problematic or the join itself fails.

EXAMPLE

function() {} . For a more elaborate example see the source code of revolve feature in the Standard Library.
joinSurfaceBodiesWithAutoMatching (context is Context, id is Id, definition is map, reconstructOp is function)

This function is designed to be used by surface-body-creating features (like extrude) as a boolean post-processing step with options from surfaceOperationTypePredicate and surfaceJoinStepScopePredicate. It detects matching edges of adjacent bodies and joins surface bodies at these edges.

Parameter	Type	Additional Info
id	Id	
identifier of the feature

definition	map	
defaultSurfaceScope
boolean	
Optional

EXAMPLE

true indicates merge scope of all the original and related surfaces used as input to create this surface (default)
EXAMPLE

false indicates merge scope is specified in booleanSurfaceScope
booleanSurfaceScope
Query	
Optional

targets to use if defaultSurfaceScope is false Default is qNothing()

seed
Query	
Optional

Default is qNothing() If set, will be included in the tools section of the boolean.

makeSolid
boolean	
Optional

Tries to join the surfaces into a solid Default is false

eraseImprintedEdges
boolean	
Optional

Merge all mergeable imprinted edges created by the boolean operation Default is true

reconstructOp	function	
A function which takes in an Id, and reconstructs the input to show to the user as error geometry in case the input is problematic or the join itself fails.

EXAMPLE

function() {} . For a more elaborate example see the source code of revolve feature in the Standard Library.
bridgingCurve
BridgingCurveMatchType enum

Specifies how the bridging curve will match the vertex or edge at each side

Value	Description
POSITION	
The bridging curve will end at the provided vertex. Direction of the curve is unspecified

TANGENCY	
The bridging curve will end at the vertex and the curve will be tangent to the edge

CURVATURE	
The bridging curve will end at the vertex and the curve will have same curvature as the edge at the vertex

G3	
BIAS_BOUNDS const

A RealBoundSpec for bias of a tangency/tangency bridge, defaulting to 0.5.

bridgingCurve (context is Context, id is Id, definition is map)

Creates a curve between two points, optionally with matching of tangency or curvature to other curves at that point

SideQueries type

Data type for side queries

Value	Type	Description
SideQueries	map	
vertex
Query	
Optional

The vertex element on a side query

edge
Query	
Optional

The edge element on a side query

face
Query	
Optional

The face element on a side query

SideData type

Data type for precomputed side data

Value	Type	Description
SideData	map	
point
Vector	
The position

frame
EdgeCurvatureResult	
Optional

The coordSystem and curvature at the given position

TwoSidesData type

Aggregation of both sides SideData

Value	Type	Description
TwoSidesData	map	
side1
SideData	
SideData map for start side

side2
SideData	
SideData map for end side

BridgingSideData type

Data type for unified control points computation

Value	Type	Description
BridgingSideData	map	
degree
number	
0 for positional continuity (G0), 1 for tangent continuity (G1), 2 for curvature continuity (G2)

position
Vector	
The position

tangent
Vector	
Required if degree >= 1

The tangent direction vector

speedScale
number	
Optional

How much to scale the default speed

curvatureDirection
Vector	
Required if degree == 2

The curvature direction vector

curvature
ValueWithUnits	
Required if degree == 2

The curvature magnitude (inverse length units)

curvatureOffsetScale
number	
Optional

How much to scale the default third control point offset

computeBridgingControlPoints (context is Context, side1 is BridgingSideData, side2 is BridgingSideData) returns array

Returns an array of control points for a bridigng bezier curve given two side constraints

bsurf
BSurfEndDerivativeType enum

Specifies an end condition for one side of a boundary surface.

Value	Description
DEFAULT	
NORMAL_TO_PROFILE	
TANGENT_TO_PROFILE	
MATCH_TANGENT	
MATCH_CURVATURE	
NORMAL_DIRECTION	
TANGENT_DIRECTION	
BSurfComputationType enum

How the boundary surface is computed

Value	Description
COONS	
MINIMIZATION	
boundarySurface (context is Context, id is Id, definition is map)

Feature for testing Boundary Surface strategies

chamfer
chamfer (context is Context, id is Id, definition is map)

The chamfer feature directly performs an opChamfer operation.

circularPattern
circularPattern (context is Context, id is Id, definition is map)

Performs a body, face, or feature circular pattern. Internally, performs an applyPattern, which in turn performs an opPattern or, for a feature pattern, calls the feature function.

Parameter	Type	Additional Info
definition	map	
patternType
PatternType	
Optional

Specifies a PART, FEATURE, or FACE pattern. Default is PART.

entities
Query	
Required if patternType is PART

The parts to pattern.

EXAMPLE

qCreatedBy(id + "extrude1", EntityType.BODY)
faces
Query	
Required if patternType is FACE

The faces to pattern.

instanceFunction
FeatureList	
Required if patternType is FEATURE

The FeatureList of the features to pattern.

axis
Query	
The axis of the pattern.

angle
ValueWithUnits	
The angle between each pattern instance, or the total angle spanned by the pattern if equalSpace is true.

EXAMPLE

360 * degree
instanceCount
number	
The resulting number of pattern entities, unless isCentered is true.

EXAMPLE

4 to have 4 resulting pattern entities (including the seed).
oppositeDirection
boolean	
Optional

EXAMPLE

true to switch the direction of the pattern around the axis.
equalSpace
boolean	
Optional

EXAMPLE

true for the entire pattern to lie within angle
EXAMPLE

false for there to be angle between each pattern instance (default)
isCentered
boolean	
Optional

Whether to center the pattern on the seed. When set to true, instanceCount - 1 pattern entities are created in each direction around the axis. Default is false.

operationType
NewBodyOperationType	
Optional

Specifies how the newly created body will be merged with existing bodies.

defaultScope
boolean	
Optional

EXAMPLE

true to merge with all other bodies
EXAMPLE

false to merge with booleanScope
booleanScope
Query	
Required if defaultScope is false

The specified bodies to merge with.

skipInstances
boolean	
Optional

Whether to exclude certain instances of the pattern.

skippedInstances
array	
Required if skipInstances is true

Which instances of the pattern to skip. Each is denoted by a single index, which may be negative if isCentered is true.

EXAMPLE

[{ index: -3 }, { index: 2 }, { index: 5 }]
compositeCurve
compositeCurve (context is Context, id is Id, definition is map)

Creates one or more Curves that are a combination of edges from various sources, be they parts, surfaces, sketches or other Curves.

compositePart
compositePart (context is Context, id is Id, definition is map)

Feature that creates a composite part from provided bodies. Performs an opCreateCompositePart.

constrainedSurface
ConstrainedSurfaceType enum

Constrained surface input type

Value	Description
POINTS	
MESH	
OptimizationMethod enum

Constrained surface optimization type

Value	Description
PERF	
Faster performance that may produce lower-quality surfaces.

SMOOTH	
Typically produces higher-quality surfaces with lower curvatures, but with slower performance and more control points.

constrainedSurface (context is Context, id is Id, definition is map)

Constrained surface feature. Takes an arbitrary number of vertices and optional normal directions or meshes and creates a surface passing through the vertices/mesh points within a provided tolerance.

constrainedSurface(context, id + "FG2MuQGCNLssvyp_123", {
     "csType" : ConstrainedSurfaceType.MESH,
     "vertices" : [],
     "meshes" : qUnion([iLEjUaBPUqVOpC_query]),
     "tolerance" : { 'value' : try(1 * inch), 'expression' : "1 in" }.value,
     "optimize" : OptimizationMethod.PERF
});
Parameter	Type	Additional Info
definition	map	
csType
ConstrainedSurfaceType	
Determines if the input is a mesh or a collection of points.

vertices
array	
Required if csType is ConstrainedSurfaceType.POINTS

An array of elements, each with a vertex on the surface to include. Optionally, specify a directional object to set the normal in the normal field, and set flipNormal to true to flip the normal.

EXAMPLE

[
    {"vertex": qVertex1},
    {"vertex": qVertex2},
    {"vertex": qVertex3, "normal": qNormal1},
    {"vertex": qVertex4, "normal": qNormal2, "flipNormal": true}
]
meshes
Query	
Required if csType is ConstrainedSurfaceType.MESH

A query of mesh faces or bodies. Each mesh vertex of the query elements is on the constrained surface.

EXAMPLE

"meshes" : qUnion([iLEjUaBPUqVOpC_query])
tolerance
ValueWithUnits	
Length to define how far from each vertex the constrained surface can be.

optimize
OptimizationMethod	
Whether to optimize for performance (OptimizationMethod.PERF) or smoothness (OptimizationMethod.SMOOTH).

cplane
CPlaneType enum

The method of defining a construction plane.

Value	Description
OFFSET	
PLANE_POINT	
LINE_ANGLE	
LINE_POINT	
THREE_POINT	
MID_PLANE	
CURVE_POINT	
TANGENT_PLANE	
cPlane (context is Context, id is Id, definition is map)

Creates a construction plane feature by calling opPlane.

curvePattern
CurvePatternSpacingType enum

Specifies the type of spacing between pattern instances.

Value	Description
EQUAL	
Equal-spaced instances along the length of curve

DISTANCE	
Instances spaced by custom distance

curvePattern (context is Context, id is Id, definition is map)

Performs a body, face, or feature curve pattern. Internally, performs an applyPattern, which in turn performs an opPattern or, for a feature pattern, calls the feature function.

Parameter	Type	Additional Info
definition	map	
patternType
PatternType	
Optional

Specifies a PART, FEATURE, or FACE pattern. Default is PART.

entities
Query	
Required if patternType is PART

The parts to pattern.

EXAMPLE

qCreatedBy(id + "extrude1", EntityType.BODY)
faces
Query	
Required if patternType is FACE

The faces to pattern.

instanceFunction
FeatureList	
Required if patternType is FEATURE

The FeatureList of the features to pattern.

edges
Query	
A Query for a set of edges to pattern along. The edges must form a continuous path.

spacingType
CurvePatternSpacingType	
Specifies the type of spacing between pattern entities. Default is EQUAL.

distance
ValueWithUnits	
Required if spacingType is DISTANCE

The distance between each pattern entity.

EXAMPLE

1.0 * inch to space the pattern entities 1 inch apart.
instanceCount
number	
The resulting number of pattern entities.

EXAMPLE

2 to have 2 resulting pattern entities (including the seed).
keepOrientation
boolean	
Optional

EXAMPLE

true for the pattern entities to keep the orientation of the seed
EXAMPLE

false for the pattern entities to reorient along the path (default)
operationType
NewBodyOperationType	
Optional

Specifies how the newly created body will be merged with existing bodies.

defaultScope
boolean	
Optional

EXAMPLE

true to merge with all other bodies
EXAMPLE

false to merge with booleanScope
booleanScope
Query	
Required if defaultScope is false

The specified bodies to merge with.

skipInstances
boolean	
Optional

Whether to exclude certain instances of the pattern.

skippedInstances
array	
Required if skipInstances is true

Which instances of the pattern to skip. Each is denoted by a single positive index.

EXAMPLE

[{ index: 2 }, { index: 5 }]
cutlist
cutlist (context is Context, id is Id, definition is map)

Create a cut list from a set of frame selections.

cutlistEditLogic (context is Context, id is Id, oldDefinition is map, definition is map, isCreating is boolean) returns map

internal

decal
decal (context is Context, id is Id, definition is map)

Feature to place and position decal attributes on a surface.

vectorInPlanePerpendicularToZ (planeNormal is Vector) returns Vector

For a plane, get the x direction that is perpendicular to the global Z axis

deleteBodies
CompositePartDeleteOptions enum

Options that determine how the Delete part feature handles composite parts

Value	Description
DELETE	
Any selected composite parts are deleted along with their constituents

DISSOLVE	
Constituents of composites are only deleted if explicitly selected

IGNORE	
Disallow selection of composite parts

deleteBodies (context is Context, id is Id, definition is map)

Feature performing an opDeleteBodies.

deleteFace
DeleteFaceType enum

Specifies how the void resulting from delete face should be closed, if at all.

Value	Description
HEAL	
Close void by shrinking or growing adjacent faces.

CAP	
Close void by a simple surface passing through all edges.

VOID	
Do not close the void. Creates surface out of solids.

deleteFace (context is Context, id is Id, definition is map)

Feature performing an opDeleteFace. Has options to heal the void created by removing the selected faces, or to leave it open.

draft
DraftFeatureType enum

Types of drafts available for the draft feature.

Value	Description
NEUTRAL_PLANE	
Draft by holding the intersection between a set of faces and a neutral plane as a constant.

PARTING_LINE	
Draft by holding a set of parting edges as a constant.

PartingLineSides enum

Specifies which faces to draft when drafting with DraftFeatureType.PARTING_LINE.

Value	Description
ONE_SIDED	
Draft one of the faces attached to the parting line.

SYMMETRIC	
Draft both of the faces attached to the parting line symmetrically.

TWO_SIDED	
Draft both of the faces attached to the parting line with separate draft angles.

draft (context is Context, id is Id, definition is map)

Feature performing an opDraft.

Parameter	Type	Additional Info
definition	map	
draftFeatureType
DraftFeatureType	
Optional

Specifies a NEUTRAL_PLANE or PARTING_LINE draft. Default is NEUTRAL_PLANE.

neutralPlane
Query	
Required if draftFeatureType is NEUTRAL_PLANE

A planar face or mate connector defining both the neutral plane and pull direction of the the draft. The intersection of the drafted faces and the neutral plane remains unchanged. The pull direction of the draft will be the face normal or mate connector z-axis.

draftFaces
Query	
Required if draftFeatureType is NEUTRAL_PLANE

The faces to draft for a NEUTRAL_PLANE draft.

pullDirectionEntity
Query	
Required if draftFeatureType is PARTING_LINE

An entity defining the pull direction of the draft. This entity should conform to the ALLOWS_DIRECTION specification in QueryFilterCompound.

partingEdges
Query	
Required if draftFeatureType is PARTING_LINE

Edges defining the parting line of the draft. These edges will remain unchanged as some adjacent faces, as defined by partingLineSides, are drafted.

hintFaces
Query	
Optional

For Onshape internal use. For PARTING_LINE draft, specifies in advance which adjacent faces of partingEdges should be treated as more along the pull direction. When unspecified, the feature will use a geometric calculation to determine this distinction.

partingLineSides
PartingLineSides	
Required if draftFeatureType is PARTING_LINE

Specifies whether to draft one or both faces adjacent to the parting edges, and whether the draft should be symmetrical if drafting both faces. See PartingLineSides.

alongPull
boolean	
Required if PartingLineSides is ONE_SIDED

Specifies which face will be drafted in a ONE_SIDED PARTING_LINE draft. If true, the face which is more along the pull direction from the perspective of the parting edge is drafted. If false, the face which is more away from the pull direction from the perspective of the parting edge is drafted.

angle
ValueWithUnits	
The draft angle, must be between 0 and 89.9 degrees.

EXAMPLE

3 * degree
pullDirection
boolean	
Optional

Whether the pull direction of the draft should be reversed. In equivalent terms, whether the draft should use -angle as the draft angle (true), or angle as the draft angle (false). Default is false.

secondAngle
ValueWithUnits	
Required if PartingLineSides is TWO_SIDED

The second draft angle for a TWO_SIDED PARTING_LINE draft. Must be between 0 and 89.9 degrees. Note that when using TWO_SIDED, angle will be applied to faces that are away from the pull direction, from the perspective of the edge. secondAngle will be applied to faces that are along the pull direction, from the perspective of the edge.

EXAMPLE

3 * degree
secondPullDirection
boolean	
Optional

Whether the pull direction of the draft should be reversed for the second angle of a TWO_SIDED draft. In equivalent terms, whether the draft should use -secondAngle as the second draft angle (true), or secondAngle as the second draft angle (false). Default is false.

tangentPropagation
boolean	
Optional

For a NEUTRAL_PLANE draft, true to propagate draft across tangent faces. Default is false.

referenceEdgePropagation
boolean	
Optional

For a PARTING_LINE draft, true to extend the parting line across connected edges of already included faces and tangent faces. Default is false.

reFillet
boolean	
Optional

true to attempt to defillet draft faces before the draft and reapply the fillets after. Default is false.

editCurve
CONTROL_POINT_INDEX_BOUND const

An IntegerBoundSpec for control point indices.

PlaneReference enum

Reference plane enum for planarization

Value	Description
BEST	
YZPLANE	
XZPLANE	
XYPLANE	
CUSTOM	
EditPointMode enum

Edit point mode

Value	Description
XYZ	
UVN_TANGENT	
UVN_CONTROL_POLYGON	
editCurve (context is Context, id is Id, definition is map)

A curve editing feature.

onEditCurveManipulatorChange (context is Context, definition is map, newManipulators is map) returns map

Manipulator change handling for curve editing

editCurveEditLogic (context is Context, id is Id, oldDefinition is map, definition is map, isCreating is boolean) returns map

Edit logic function for curve editing

enclose
enclose (context is Context, id is Id, definition is map)

Feature performing an opEnclose.

endcap
endcap (context is Context, id is Id, definition is map)

Construct a endcap.

extend
ExtendBoundingType enum

Bounding type used with extend.

Value	Description
BLIND	
UP_TO_FACE	
UP_TO_BODY	
UP_TO_VERTEX	
extendSurface (context is Context, id is Id, definition is map)

Extends a surface body by calling opExtendSheetBody.

externalThread
externalThread (context is Context, id is Id, definition is map)

Given a list of edge or selections and an optional offset, find the cylindrical faces corresponding to them split the face at the offset, and add external thread size data.

getSplitData (context is Context, topLevelId is Id, endEdge is Query, minorDiameter is ValueWithUnits) returns map

From a starting edge selection, get data about a valid cylindrical face to annotation and/or cut and data about the direction to cut.

extrude
extrude (context is Context, id is Id, definition is map)

Create an extrude, as used in Onshape's extrude feature.

Internally, performs an opExtrude, followed by an opBoolean, possibly followed by a opDraft, possibly in two directions. If creating a simple extrusion, prefer using opExtrude alone.

Parameter	Type	Additional Info
definition	map	
bodyType
ExtendedToolBodyType	
Optional

Specifies a SOLID or SURFACE or THIN extrude. Default is SOLID.

entities
Query	
Required if bodyType is SOLID

The planar faces and/or sketch regions to extrude.

EXAMPLE

qSketchRegion(id + "sketch1") specifies all sketch regions of a given sketch.
surfaceEntities
Query	
Required if bodyType is SURFACE

The sketch curves to extrude.

EXAMPLE

qCreatedBy(id + "sketch1", EntityType.EDGE)
endBound
BoundingType	
Optional

The end bounding condition for the extrude. Default is BLIND.

oppositeDirection
boolean	
Optional

EXAMPLE

true to flip the direction of the extrude to point opposite the face/sketch normal.
depth
ValueWithUnits	
Required if endBound is BLIND

A length specifying the extrude depth. For a blind extrude, specifies the depth of the first extrude direction. For a symmetric extrude, specifies the full extrude depth.

EXAMPLE

0.5 * inch
endBoundEntityFace
Query	
Required if endBound is UP_TO_SURFACE

Specifies the face or surface to bound the extrude.

endBoundEntityBody
Query	
Required if endBound is UP_TO_BODY

Specifies the surface or solid body to bound the extrude.

endBoundEntityVertex
Query	
Required if endBound is UP_TO_VERTEX

Specifies the vertex to bound the extrude.

hasOffset
boolean	
Optional

EXAMPLE

true to add a translational offset from the selected face, surface, solid body or vertex.
offsetDistance
ValueWithUnits	
Required if offset is true

The translational distance between the selected face, surface, solid body or vertex and the cap of the extrude.

EXAMPLE

0.5 * inch
offsetOppositeDirection
boolean	
Optional

EXAMPLE

false to offset away from the selected end bound (default)
EXAMPLE

true to offset into the selected end bound
hasDraft
boolean	
Optional

EXAMPLE

true to add a draft to the extrude.
draftAngle
ValueWithUnits	
Required if hasDraft is true

The angle, as measured from the extrude direction, at which to draft.

EXAMPLE

10 * degree
draftPullDirection
boolean	
Optional

EXAMPLE

false to draft outwards (default)
EXAMPLE

true to draft inwards
hasSecondDirection
boolean	
Optional

EXAMPLE

true to specify a second direction.
secondDirectionBound
BoundingType	
Optional

The bounding type of the second direction. Can be different from the bounding type of the first direction.

secondDirectionOppositeDirection
boolean	
Optional

EXAMPLE

true will flip the second end direction to align opposite the plane/face's normal.
secondDirectionDepth
ValueWithUnits	
Required if secondDirectionBound is BLIND

A length specifying the second direction's extrude depth.

secondDirectionBoundEntityFace
Query	
Required if secondDirectionBound is UP_TO_SURFACE

specifies the face or surface to bound the extrude.

secondDirectionBoundEntityBody
Query	
Required if secondDirectionBound is UP_TO_BODY

specifies the surface or solid body to bound the extrude.

secondDirectionBoundEntityVertex
Query	
Required if secondDirectionBound is UP_TO_VERTEX

specifies the vertex to bound the extrude.

hasSecondDirectionOffset
boolean	
Optional

EXAMPLE

true to add a translational offset from the selected face, surface, solid body or vertex.
secondDirectionOffsetDistance
ValueWithUnits	
Required if offset is true

The translational distance between the selected face, surface, solid body or vertex and the cap of the extrude.

EXAMPLE

0.5 * inch
secondDirectionOffsetOppositeDirection
boolean	
Optional

EXAMPLE

false to offset away from the selected second direction end bound (default)
EXAMPLE

true to offset into the selected second direction end bound
hasSecondDirectionDraft
boolean	
Optional

EXAMPLE

true to add a draft to the second direction extrude.
secondDirectionDraftPullDirection
boolean	
Optional

EXAMPLE

false to draft the second direction outwards (default)
EXAMPLE

true to draft the second direction inwards
operationType
NewBodyOperationType	
Optional

Specifies how the newly created body will be merged with existing bodies.

defaultScope
boolean	
Optional

EXAMPLE

true to merge with all other bodies
EXAMPLE

false to merge with booleanScope
booleanScope
Query	
Required if defaultScope is false

The specified bodies to merge with.

wallShape
Query	
Required if bodyType is THIN

The specified planar face or sketch edges defining the thin wall shape.

thickness1
ValueWithUnits	
Required if bodyType is THIN

The outwards thickness of the thin wall.

thickness2
ValueWithUnits	
Required if bodyType is THIN

The inwards thickness of the thin wall.

flipWall
boolean	
Optional

EXAMPLE

true to apply the first offset value instead of the second and vice versa
faceBlend
faceBlend (context is Context, id is Id, definition is map)

Feature performing a face blend.

faceIntersection
intersectionCurve (context is Context, id is Id, definition is map)

Creates curves where two faces intersect.

fillSurface
fill (context is Context, id is Id, definition is map)

Creates a surface bounded by input edges with prescribed continuity conditions, using opFillSurface.

fillet
fillet (context is Context, id is Id, definition is map)

Feature performing an opFillet or opFullRoundFillet.

fitSpline
FitSplineType enum

The type of fit spline.

Value	Description
VERTICES	
Creates spline through selected vertices.

EDGES	
Approximates a set of edges by a single spline.

fitSpline (context is Context, id is Id, definition is map)

Feature performing either opFitSpline or opSplineThroughEdges depending on selection

frame
frame (context is Context, id is Id, definition is map)

Create frames from a profile and set of path selections.

frameTrim
frameTrim (context is Context, id is Id, definition is map)

Trim frames against faces, or perform an ordered trim of frame groups.

gusset
GussetStyleType enum

Defines the shape of the gusset.

Value	Description
TRIANGLE	
RECTANGLE	
GussetPosition enum

Defines the alignment of the gusset.

Value	Description
CENTERED	
ALIGNED	
gusset (context is Context, id is Id, definition is map)

Create gussets based on the selected edges.

helix
AxisType enum

Describes the type of body on which to create a helix.

Value	Description
SURFACE	
Impose a helix onto a cylinder or cone.

AXIS	
Revolve a helix around an axial edge or mate connector.

CIRCLE	
Revolve a helix along a circular path.

PathType enum

Describes the parameter(s) to vary when computing the path of a helix.

Value	Description
TURNS	
Allow only the number of turns (revolutions) to be varied.

PITCH	
Allow only the space between each turn (helical pitch) to be varied.

TURNS_PITCH	
Allow both turns and pitch to be varied. Always results in a cylindrical helix.

StartType enum

Describes the starting condition of a helix.

Value	Description
START_ANGLE	
Start the helix at an angle around the origin of the base.

START_POINT	
Start the helix at a point of choice along the plane of the base.

EndType enum

Describes the ending condition of a helix.

Value	Description
HEIGHT	
End the helix at a specified height.

END_POINT	
End the helix at a specified point along a perpendicular plane to the base.

Direction enum

Describes the direction a helix turns while traveling along its axis.

Value	Description
CW	
Clockwise.

CCW	
Counterclockwise.

helix (context is Context, id is Id, definition is map)

Feature performing an opHelix.

hole
HoleEndStyle enum

Defines the end bound for the hole cut.

Value	Description
BLIND	
Cut holes to a specific depth.

BLIND_IN_LAST	
Cut holes through all parts but the last, then cut to a specific depth in the last part.

UP_TO_NEXT	
UP_TO_ENTITY	
THROUGH	
Cut holes with a through-all extrude.

HoleEndStyleV2 enum

Defines the end bound for the hole cut.

Value	Description
BLIND	
Cut holes to a specific depth.

UP_TO_NEXT	
UP_TO_ENTITY	
THROUGH	
Cut holes with a through-all extrude.

TipAngleStyle enum

Defines the tip angle style for the hole tip

Value	Description
DEGREE118	
Tip angle is set at 118 degrees

DEGREE135	
Tip angle is set at 135 degrees

FLAT	
Tip angle is flat or 180 degrees

CUSTOM	
User inputs specific angle value

HoleStartStyle enum

Defines the options to adjust hole position.

Value	Description
PART	
Cut holes starting from the hole location.

SKETCH	
Cut holes starting from the first full entrance.

PLANE	
Cut holes starting at the selected input.

parsePitch (context is Context, pitch is string)

Parse and split the numerical and unit portion of a pitch string, e.g. "20 tpi"

buildPitchAnnotation (context is Context, pitch is string)

Parse a pitch string, e.g. "20 tpi" or "1.5 mm, and return its annotation suffix in imperial or metric format, e.g. -20 or x1.5

hole (context is Context, id is Id, definition is map)

Creates holes of specific dimensions and style, based either on standard hole size, or by user-defined values. Each hole's position and orientation are specified using sketch points.

CSINK_ANGLE_BOUNDS const

Angle bounds for a hole countersink.

computePitchValue (context is Context, pitch is string)

Extract value from pitch string

clusterVertexQueries (context is Context, selected is Query) returns array

Expects selected query to evaluate to a set of vertices. Throws if non-vertex is passed.

Clusters coincident vertices created by the same operation, it is important to group by operation because we may have multiple sketches with different normals which share a location. We would still want to make two holes in that case.

Returns an array of vertices, each representing the "first" vertex of a cluster, where "first" is determined by the query evaluation order of selected. The overall ordering of the returned array will also respect the query evaluation order of selected.

holeTable
holeTable const

Computes one hole table for each part

importDerived
DerivedPlacementType enum

Enum controlling the placement of derived entities in the target part studio.

Value	Description
AT_ORIGIN	
AT_MATE_CONNECTOR	
BuildFunction type

A special type for functions defined as the build function for a Part Studio, which return a context containing parts.

canBeBuildFunction (value) predicate

Typecheck for BuildFunction

importDerived (context is Context, id is Id, definition is map)

Feature using PartStudioData for including parts in one Part Studio that were designed in another.

Location query determines where in the current Part Studio the selections will be located. Bringing in multiple instances using multiple location queries is allowed but not recommended.

One can use the origin or a mate connector from the base Part Studio for placement in the current Part Studio.

importForeign
ForeignId type

A string representing a foreign element, such as the dataId from an imported tab.

canBeForeignId (value) predicate

Typecheck for ForeignId

importForeign (context is Context, id is Id, definition is map)

Feature performing an opImportForeign, transforming the result if necessary.

isocline
isocline (context is Context, id is Id, definition is map)

Creates curves or split faces in a given direction at a given degree.

isoparametricCurve
isoparametricCurve (context is Context, id is Id, definition is map)

Creates isoparametric curves on faces by using opCreateCurvesOnFace

linearPattern
linearPattern (context is Context, id is Id, definition is map)

Performs a body, face, or feature linear pattern. Internally, performs an applyPattern, which in turn performs an opPattern or, for a feature pattern, calls the feature function.

Parameter	Type	Additional Info
definition	map	
patternType
PatternType	
Optional

Specifies a PART, FEATURE, or FACE pattern. Default is PART.

entities
Query	
Required if patternType is PART

The parts to pattern.

EXAMPLE

qCreatedBy(id + "extrude1", EntityType.BODY)
faces
Query	
Required if patternType is FACE

The faces to pattern.

instanceFunction
FeatureList	
Required if patternType is FEATURE

The FeatureList of the features to pattern.

directionOne
Query	
The direction of the pattern.

EXAMPLE

qCreatedBy(newId() + "Right", EntityType.FACE)
distance
ValueWithUnits	
The distance between each pattern entity.

EXAMPLE

1.0 * inch to space the pattern entities 1 inch apart.
instanceCount
number	
The resulting number of pattern entities, unless isCentered is true.

EXAMPLE

2 to have 2 resulting pattern entities (including the seed).
oppositeDirection
boolean	
Optional

EXAMPLE

true to switch the direction of the pattern along directionOne.
isCentered
boolean	
Optional

Whether to center the pattern on the seed. When set to true, instanceCount - 1 pattern entities are created along each direction of directionOne. Default is false.

hasSecondDir
boolean	
Optional

EXAMPLE

true if the pattern should extend in two directions rather than one, creating a grid of pattern entities.
directionTwo
Query	
Required if hasSecondDir is true

The second direction of the pattern.

distanceTwo
ValueWithUnits	
Required if hasSecondDir is true

The distance between each pattern entity in the second direction.

instanceCountTwo
number	
Required if hasSecondDir is true

The resulting number of pattern entities in the second direction, unless isCentered is true.

oppositeDirectionTwo
boolean	
Optional

EXAMPLE

true to switch the direction of the pattern along directionTwo.
isCenteredTwo
boolean	
Optional

Whether to center the second direction of the pattern on the seed. When set to true, instanceCount - 1 pattern entities are created along each direction of directionTwo. Default is false.

operationType
NewBodyOperationType	
Optional

Specifies how the newly created body will be merged with existing bodies.

defaultScope
boolean	
Optional

EXAMPLE

true to merge with all other bodies
EXAMPLE

false to merge with booleanScope
booleanScope
Query	
Required if defaultScope is false

The specified bodies to merge with.

skipInstances
boolean	
Optional

Whether to exclude certain instances of the pattern.

skippedInstances
array	
Required if skipInstances is true

Which instances of the pattern to skip. Each is denoted by one index for each direction, either of which may be negative if isCentered or isCenteredTwo respectively is true.

EXAMPLE

[{ index1: -3, index2: 1 }, { index1: 0, index2: -2 }, { index1: 5, index2: 0 }]
loft
LoftEndDerivativeType enum

Specifies an end condition for one side of a loft.

Value	Description
DEFAULT	
NORMAL_TO_PROFILE	
TANGENT_TO_PROFILE	
MATCH_TANGENT	
MATCH_CURVATURE	
NORMAL_DIRECTION	
TANGENT_DIRECTION	
LoftGuideDerivativeType enum

Specifies derivative condition for a guide

Value	Description
DEFAULT	
NORMAL_TO_GUIDE	
TANGENT_TO_GUIDE	
MATCH_TANGENT	
MATCH_CURVATURE	
loft (context is Context, id is Id, definition is map)

Feature performing an opLoft.

mateConnector
mateConnector (context is Context, id is Id, definition is map)

Feature performing an opMateConnector.

The parameters below are designed for interactive use in the feature dialog. In FeatureScript, it is preferred to calculate the resulting coordinate system directly, and pass this coordinate system to opMateConnector.

Parameter	Type	Additional Info
definition	map	
originQuery
Query	
The entity on which to place the mate connector

EXAMPLE

qFarthestAlong(qCreatedBy(id + "extrude1", EntityType.VERTEX), vector(1, 1, 1))
entityInferenceType
EntityInferenceType	
A method of producing the coordinate system

EXAMPLE

EntityInferenceType.POINT to place on a vertex, with the world coordinate system
EXAMPLE

EntityInferenceType.MID_POINT to place at the midpoint of an edge, with the Z axis along the edge
secondaryOriginQuery
query	
Optional

Additional entity to inference with, used in some inference types.

originType
OriginCreationType	
Optional

EXAMPLE

OriginCreationType.BETWEEN_ENTITIES to place mate connector origin on the midpoint between the speicified origin and the location of originAdditionalQuery. Default is OriginCreationType.ON_ENTITY.
originAdditionalQuery
Query	
Required if originType is OriginCreationType.BETWEEN_ENTITIES

flipPrimary
boolean	
Optional

EXAMPLE

true to flip the resulting Z axis
secondaryAxisType
MateConnectorAxisType	
Optional

Changes which axis (perpendicular to Z) will point along the secondary direction. Default is MateConnectorAxisType.PLUS_X

realign
boolean	
Optional

true to change direction of axes

primaryAxisQuery
Query	
Required if realign is true

Entity with axis to define the resulting Z direction

secondaryAxisQuery
Query	
Required if realign is true

Entity with axis to define the secondary axis (set by secondaryAxisType)

transform
boolean	
Optional

Whether to change the origin position with translationX, translationY, and translationZ. The X/Y/Z directions of this translation are affected by primaryAxisQuery and secondaryAxisQuery and secondaryAxisType, but not by rotationType and rotation

translationX
ValueWithUnits	
Required if transform is true

Distance to move the resulting origin along resulting X direction.

translationY
ValueWithUnits	
Required if transform is true

Distance to move the resulting origin along resulting Y direction

translationZ
ValueWithUnits	
Required if transform is true

Distance to move the resulting origin along resulting Z direction

rotationType
RotationType	
Optional

Axis to rotate around (does not change origin position)

rotation
ValueWithUnits	
Optional

Angle to rotate

requireOwnerPart
boolean	
Optional

Whether to error if owner part is not provided. Default is true. If false, the mate connector may be an independent body with no owner part.

ownerPart
Query	
Required if requireOwnerPart is not false

Part on which to attach the resulting mate connector

specifyNormal
boolean	
Optional

EXAMPLE

true override the Z direction with the known vector (definition.nx, definition.ny, definition.nz). Used internally when the mate connector is placed on a mesh.
nx
number	
Required if specifyNormal is true

ny
number	
Required if specifyNormal is true

nz
number	
Required if specifyNormal is true

mirror
mirror (context is Context, id is Id, definition is map)

Feature creating a single copy of some features, bodies, or faces, mirrored about a given entity. Internally, performs an applyPattern, which in turn performs an opPattern or, for a feature mirror, calls the feature function.

modifyFillet
ModifyFilletType enum

Defines the action of a modifyFillet feature.

Value	Description
CHANGE_RADIUS	
REMOVE_FILLET	
modifyFillet (context is Context, id is Id, definition is map)

Feature performing an opModifyFillet.

moveCurveBoundary
trimCurve (context is Context, id is Id, definition is map)

Extend or trim a curve. This is a thin wrapper around opMoveCurveBoundary.

moveFace
moveFace (context is Context, id is Id, definition is map)

Feature performing an opMoveFace.

deripEdges (context is Context, id is Id, edges is Query) returns boolean

Splits input sheet metal edges and adjusts them to lie on corresponding sheet metal part faces.

mutualTrim
mutualTrim (context is Context, id is Id, definition is map)

Trim two adjacent surfaces by extending intersections to complete the trim.

offsetCurveOnFace
OffsetCurveScope enum

Drives the extend and imprint booleans in opOffsetCurveOnFace.

Value	Description
OFFSET	
OFFSET_AND_EXTEND	
OFFSET_EXTEND_AND_SPLIT	
GapFill enum

Whether to use linear or rounded extensions to connect discontinuities within offset wires.

Value	Description
LINEAR	
ROUND	
offsetCurveOnFace (context is Context, id is Id, definition is map)

Feature performing an offset curve.

offsetSurface
offsetSurface (context is Context, id is Id, definition is map)

Feature performing an opExtractSurface. Allows creation of an offset surface from faces, surfaces, or sketch regions. Offset may be zero. Offset direction may be flipped using the oppositeDirection flag.

projectCurves
CurveProjectionType enum

Specifies the method used for generating intersection curves.

Value	Description
TWO_SKETCHES	
Performs opExtrude to convert sketches into surface, then uses opBoolean to intersect those surfaces.

CURVE_TO_FACE	
Performs opDropCurve to project curves onto faces.

projectCurves (context is Context, id is Id, definition is map)

Feature creating projected curves.

Parameter	Type	Additional Info
definition	map	
curveProjectionType
CurveProjectionType	
Optional

The method used for generating intersection curves. Default is TWO_SKETCHES.

sketchEdges1
Query	
Required if curveProjectionType is TWO_SKETCHES

Edges from a single sketch that will be extruded to perform an intersection.

sketchEdges2
Query	
Required if curveProjectionType is TWO_SKETCHES

Edges from a single sketch that will be extruded to perform an intersection.

dropTools
Query	
Required if curveProjectionType is CURVE_TO_FACE

Edges that will be projected onto targets.

projectionType
ProjectionType	
Required if curveProjectionType is CURVE_TO_FACE

Specifies whether to project along a direction or the face normal of targets.

directionQuery
Query	
Required if projectionType is DIRECTION

Specifies the direction of projection.

oppositeDirection
boolean	
Required if projectionType is DIRECTION

If true, negates the direction supplied by directionQuery.

targets
Query	
Required if curveProjectionType is CURVE_TO_FACE

Faces, sheet bodies, or solid bodies to project onto.

queryVariable
SelectionType enum

Allowed selection types to create query variable.

Value	Description
SELECTION	
CREATED_BY	
OWNED_BY	
PROTRUSION	
POCKET	
HOLE	
FILLETS	
BOUNDED_FACES	
LOOP_CHAIN_CONNECTED	
PARALLEL	
TANGENT_CONNECTED	
MATCHING	
ALL_SOLID_BODIES	
EDGE_CONVEXITY	
SeedType enum

Some selection types accept either faces or edges, not both. This enum allows picking which one.

Value	Description
FACE	
EDGE	
FilletCompare enum

Subset of CompareType with just types allowed in qFilletFaces

Value	Description
EQUAL	
LESS_EQUAL	
GREATER_EQUAL	
BodyTypeOptions enum

Specifies the topological type of a body, similar to BodyType, with annotations.

See also

BodyType

Value	Description
SOLID	
SHEET	
WIRE	
POINT	
MATE_CONNECTOR	
COMPOSITE	
initialQueryPredicate (definition is map) predicate

Predicate showing the selection type and the relevant queries/enum allowed by this type.

additionalQueryPredicate (addQ is map) predicate

Same as initialQueryPredicate, needs to be separate because of naming restriction in array parameters.

queryVariable (context is Context, id is Id, definition is map)

Feature to create a query variable via calling setQueryVariable. This variable may be used in featurescript via call getQueryVariable or in the UI by clicking the "Variable selection" dropdown in the feature dialog or by selecting the query variable feature in the feature list.

Parameter	Type	Additional Info
definition	map	
name
string	
The name of the feature. Must not belong to a non-query variable feature. If a query variable feature with this name exists, it will be overwritten after this feature.

description
string	
Description of the variable. Maximum length of 256 characters.

selectionType
SelectionType	
The type of selection the initial query will hold.

seedType
SeedType	
If the selection type allows edges or faces, selects the seed type.

selectionQuery
Query	
If selectionType is SELECTION, query that will be contained in the variable.

createdByFeatures
FeatureList	
If selectionType is CREATED_BY, features whose created entities will be contained in the variable.

seedBodies
Query	
If selectionType is OWNED_BY or EDGE_CONVEXITY, bodies owning the entities that will be contained in the variable.

seedFaces
Query	
If selectionType is PROTRUSION or POCKET or HOLE or FILLETS or BOUNDED_FACES, or TANGENT_CONNECTED or MATCHING and seedType is FACE, faces from which the selection is created.

seedEdgesOrFaces
Query	
If selectionType is LOOP_CHAIN_CONNECTED, faces or edges from which the loops are computed.

seedEdgesOrFaces
Query	
If selectionType is PARALLEL, or TANGENT_CONNECTED or MATCHING and seedType is EDGE, edges from which the selection is created.

entityType
EntityType	
If selectionType is CREATED_BY or OWNED_BY, the entity type to include in the variable.

filletCompareType
FilletCompare	
If selectionType is FILLETS, the type of fillets to include in the variable.

boundedFacesBounds
Query	
If selectionType is BOUNDED_FACES, the faces or edges bounding the selection.

edgeConvexityType
EdgeConvexityType	
If selectionType is EDGE_CONVEXITY, the convexity type of edges to include in the variable.

addAdditionalQueries
boolean	
Whether to include addition queries in the variable.

additionalQueries
array	
An array of additional queries to include. Each item's content is analogous to what is contained in the original query. It also contains a booleanOperation field determining how to combine the additional query with the current query.

evaluateOnUse
boolean	
Whether to evaluate the variable when it is created or when it is used.

showSelection
boolean	
Whether to highlight the entities contained in the created variable.

getQueryVariable (context is Context, name is string) returns Query

Returns a query that was previously stored in a variable of the given name.

setQueryVariable (context is Context, name is string, value is Query)

Saves a query in a variable with the given name.

setQueryVariable (context is Context, name is string, description is string, value is Query)

Saves a query in a variable with the given name and description.

replaceFace
replaceFace (context is Context, id is Id, definition is map)

Feature performing an opReplaceFace.

revolve
RevolveBoundingType enum

Types of bounds allowed in revolve operation.

Value	Description
BLIND	
UP_TO_NEXT	
UP_TO_SURFACE	
UP_TO_BODY	
UP_TO_VERTEX	
revolve (context is Context, id is Id, definition is map)

Feature performing an opRevolve, followed by an opBoolean. For simple revolves, prefer using opRevolve directly.

rib
RibExtrusionDirection enum

Specifies the direction of the rib extrusion starting from the profile going up to the part.

Value	Description
PARALLEL_TO_SKETCH_PLANE	
The direction of the rib extrusion goes parallel to the profile sketch plane.

NORMAL_TO_SKETCH_PLANE	
The direction of the rib extrusion goes normal to the profile sketch plane.

rib (context is Context, id is Id, definition is map)

Creates ribs from selected profiles. The ribs can be either free standing or merged with their mating part. Profiles must be non-construction sketch edges.

Parameter	Type	Additional Info
definition	map	
profiles
Query	
Edges which form the center lines of the ribs.

parts
Query	
Parts which form the boundary of the ribs.

thickness
ValueWithUnits	
Thickness of the ribs.

ribExtrusionDirection
RibExtrusionDirection	
Whether the rib is extruded perpendicular or parallel to the plane.

oppositeDirection
boolean	
Whether the ribs are extruded in the positive or negative direction.

hasDraft
boolean	
Optional

EXAMPLE

true to add a draft to the rib.
draftAngle
ValueWithUnits	
Required if hasDraft is true

The angle of the draft with respect to the extruded direction of the rib.

EXAMPLE

10 * degree
draftPullDirection
boolean	
Optional

EXAMPLE

false to draft outwards (default)
EXAMPLE

true to draft inwards
extendProfilesUpToPart
boolean	
Whether the ribs are extruded up to a boundary part.

mergeRibs
boolean	
Whether the ribs are merged with the mating part.

routingCurve
RoutingCurveType enum

Curve types.

Value	Description
INTERPOLATED_SPLINE	
POLYLINE	
InputType enum

Input types.

Value	Description
VERTEX	
CURVE	
CSV	
CurveStep enum

Curve edit modes.

Value	Description
POINTS	
SEGMENTS	
DerivativeAlignment enum

Interpolated spline derivative alignments.

Value	Description
X	
Y	
Z	
DIRECTION	
ReferenceType enum

Point reference types.

Value	Description
ORIGIN	
VERTEX	
CURVE	
RELATIVE	
SegmentEditType enum

Segment edit modes.

Value	Description
ADD	
ORTHOGONAL	
PointsEditType enum

Points edit modes.

Value	Description
SINGLE	
MULTI	
OrthoCoordSystem enum

Coordinate system options for the othogonal path segment edit mode.

Value	Description
WORLD	
CURVE	
OTHER	
POINT_INDEX_BOUNDS const

Integer bound for segment index in segment edit mode.

SEGMENT_INDEX_BOUNDS const

Integer bound for segment index in segment edit mode.

COLUMN_BOUNDS const

Integer bound for CSV column index.

CURVE_SAMPLE_BOUNDS const

Integer bound for curve sampling.

routingCurve (context is Context, id is Id, definition is map)

Creates a routing curve feature.

routingCurveManipulator (context is Context, definition is map, newManipulators is map) returns map

Manipulator handler for routing curve feature.

routingCurveEditLogic (context is Context, id is Id, oldDefinition is map, definition is map, isCreating is boolean, specifiedParameters is map, hiddenQueries is Query, clickedButton is string) returns map

Edit logic function for routing curve.

ruledSurface
VertexOverrideType enum

The type of ruled surface to apply at a specific vertex.

Value	Description
NORMAL	
TANGENT	
ALIGNED_WITH_VECTOR	
UP_TO_VERTEX	
RuledSurfaceInterfaceType enum

The type of ruled surface to apply for the overall operation.

Value	Description
NORMAL	
TANGENT	
ALIGNED_WITH_VECTOR	
ANGLE_FROM_VECTOR	
ruledSurface (context is Context, id is Id, definition is map)

Feature creating a ruled surface.

sheetMetalAttribute
Modules prefixed with "sheetMetal" here and below control functionality related to working with sheet metal models in Onshape.

Sheet metal models are created with the sheetMetalStart feature. The geometry of these models is not modifiable with ordinary geometry operations, and an operation which attempts to modify a sheet metal model will always throw the error ErrorStringEnum.SHEET_METAL_PARTS_PROHIBITED

Onshape's sheet metal operations are instead encapsulated in features defined with defineSheetMetalFeature. These features directly modify the underlying sheet metal master body, a hidden surface body not accessible from other features. The master body (along with SMAttributes set on its entities) provides the information necessary for updateSheetMetalGeometry to build both sheet metal bodies: the 3D folded body and the flat pattern. The result is simultaneous sheet metal editing, where geometry and errors are always available to the end user on both the folded and the flat sheet metal models.

Most custom features will function only on bodies which are not active sheet metal, because the feature's effects are not readily translatable from the folded model back to the flattened master model. A custom feature's user will typically discover this when an operation within the custom feature throws a SHEET_METAL_PARTS_PROHIBITED error, giving the user-facing message "Active sheet metal models are not allowed."

Additionally, a custom feature's query parameter can disallow selection of entities from sheet metal bodies using the ActiveSheetMetal.NO filter. Any other query can be filtered for non-sheet-metal geometry using separateSheetMetalQueries.

SMAttribute type

Sheet metal object definition attribute type.

canBeSMAttribute (value) predicate

parameters in SMAttribute (e.g. radius in BEND, angle in JOINT, thickness in MODEL) are specified as maps

EXAMPLE

{
 value : {ValueWithUnits},
 canBeEdited : {boolean},
 controllingFeatureId : {string}, : feature to be edited when editing this parameter
 parameterIdInFeature : {string}
 }
smAttributeDefault const

Empty map as SMAttribute convenient for attribute lookup

asSMAttribute (value is map) returns SMAttribute

Attach SMAttribute type to a map. convenient for attribute lookup and queries.

makeSMJointAttribute (attributeId is string) returns SMAttribute

Start SMAttribute for joint.

makeSMWallAttribute (attributeId is string) returns SMAttribute

Start SMAttribute for wall.

makeSMCornerAttribute (attributeId is string) returns SMAttribute

Start SMAttribute for corner.

getSmObjectTypeAttributes (context is Context, topology is Query, objectType is SMObjectType) returns array

Get attributes with matching objectType.

clearSmAttributes (context is Context, entities is Query)

Clear SM attributes from entities.

hasSheetMetalAttribute (context is Context, entities is Query, objectType is SMObjectType) returns boolean

Check for presence of SMAttribute types.

replaceSMAttribute (context is Context, existingAttribute is SMAttribute, newAttribute is SMAttribute) returns Query

For all entities annotated with attribute matching existingAttribute pattern, replace it with newAttribute. Return query for entities whose attributes have been modified.

getSMDefinitionEntities (context is Context, selection is Query) returns array

Find sheet metal master body entities corresponding to feature input.

getSMDefinitionEntities (context is Context, selection is Query, entityType is EntityType) returns array

isSheetMetalModelActive (context is Context, sheetMetalModel is Query) returns boolean

Check if sheet metal model is active.

areEntitiesFromSingleSheetMetalModel (context is Context, entities is Query) returns map

Check if all entities belong to the same sheet metal model

areEntitiesFromSingleActiveSheetMetalModel (context is Context, entities is Query) returns boolean

Check if all entities belong to the same active sheet metal model

getWallAttribute (context is Context, wallFace is Query)

Get wall attribute on a single entity

getJointAttribute (context is Context, jointEdge is Query)

Get joint attribute on a single entity

getCornerAttribute (context is Context, cornerVertex is Query)

Get corner attribute on a single entity

SMAssociationAttribute type

Used by sheet metal features to maintain correspondence between master sheet body entities and folded and flat solid body entities.

canBeSMAssociationAttribute (value) predicate

Association attribute stores attributeId. The association is established by assigning the same attribute to associated entities. Every entity in sheet metal master sheet body has a distinct association attribute.

makeSMAssociationAttribute (attributeId is string) returns SMAssociationAttribute

Create an association attribute with the given attributeId.

assignSMAssociationAttributes (context is Context, entities is Query)

Assign new association attributes to entities using their transient queries to generate attribute ids.

smAssociationAttributePattern const

An attribute pattern for finding attributes which are SMAssociationAttributes.

getSMAssociationAttributes (context is Context, entities is Query)

Get all of the association attributes for a given set of entities.

SMCornerBreak type

Information corresponding to a single sheet metal corner break (fillet or chamfer)

canBeSMCornerBreak (value) predicate

Corner break must hold the break style, the range (radius and distance of fillet and chamfer respectively), and the wallId of the wall that owns the corner.

makeSMCornerBreak (cornerBreakStyle is SMCornerBreakStyle, range is ValueWithUnits, wallId is string) returns SMCornerBreak

Create a corner break

addCornerBreakToSMAttribute (attribute is SMAttribute, cornerBreakMap is map) returns SMAttribute

Adds an SMCornerBreak and any additional information to an SMAttribute, initializing the cornerBreaks array if necessary.

findCornerBreak (attribute is SMAttribute, wallId is string)

Finds an SMCornerBreak in attribute corresponding to wallId, returns undefined if nothing found

updateCornerAttribute (context is Context, vertex is Query, attribute is SMAttribute)

Clears existing SMAttribute, sets new one only if non-trivial

sanitizeControllingInformation (context is Context, attribute is SMAttribute, replaceExisting is boolean) returns SMAttribute

Removes all controllingFeatureId and parameterIdInFeature information from an SMAttribute. Replaces the provided attribute with sanitized attribute if replaceExisting is true. Return the sanitized attribute

Fail if the attribute is a model attribute as a safety precaution, as removing the controllingFeatureId information from a model attribute would invalidate it from being the same model attribute as it was before

sheetMetalBend
BendAlignment enum

Values specifying the alignment of sheet metal after it is bent, relative to the line

Value	Description
BEND_LINE	
HELD_EDGE	
BENT_EDGE	
BENT_INSIDE	
BENT_OUTSIDE	
BENT_MIDPLANE	
BendAngleControlType enum

Angle types for the bend

Value	Description
BEND_ANGLE	
ALIGN_GEOMETRY	
ANGLE_FROM_DIRECTION	
sheetMetalBend (context is Context, id is Id, definition is map)

Bend a sheet metal model along a reference line, with additional bend control options.

sheetMetalBendRelief
sheetMetalBendRelief (context is Context, id is Id, definition is map)

Bend relief feature is used to override default bend relief of sheet metal model at individual bend end.

sheetMetalCorner
sheetMetalCorner (context is Context, id is Id, definition is map)

Corner feature is used to override default sheet metal model corner relief style or dimensions for an individual corner

sheetMetalCornerBreak
EdgeBlendType enum

Specifies type of edge blend

Value	Description
FILLET	
CHAMFER	
sheetMetalCornerBreak (context is Context, id is Id, definition is map)

Sheet metal specific feature combining functionality of edge fillet and chamfer. It calls SMEdgeBlendImpl to apply fillets or chamfers in flat and then change the definition surface accordingly As a result of this change rips corner/bend reliefs are also "baked" into the definition surface and flexibility of sheet metal model is lost. For this reason we recommend that this feature is used after sheet metal flanges, joints and reliefs are finalized.

sheetMetalEnd
sheetMetalEnd (context is Context, id is Id, definition is map)

Deactivate the sheet metal model of selected parts. Continued modeling on deactivated sheet metal parts will not be represented in the flat pattern or the table.

sheetMetalFlange
SMFlangeAlignment enum

Describes the position of a virtual sharp with respect to "flange face", defined as the face that corresponds to the edge selected for flange in the underlying sheet.

For Middle alignment, the virtual sharp at the intersection of the existing sheet and the sheet that corresponds to the flange wall, lies in the middle of the flange face.

For Inner alignment, the virtual sharp at the intersection of the planes defined by the faces of the solid to the interior of the bend, lies coincident with the edge of the flange face closest to the bend.

For Outer alignment, the virtual sharp at the intersection of the planes defined by the faces of the solid to the exterior of the bend, lies coincident with the edge of the flange face farthest from the bend.

Value	Description
INNER	
OUTER	
MIDDLE	
BEND	
SMPartialFlangeChainType enum

Sets the handling for chains of edges while creating a partial flange.

Value	Description
PER_EDGE	
The partial flange conditions will be applied to the ends of each individual edge.

PER_CHAIN	
The partial flange conditions will be applied to the ends of each chain of selected edges.

sheetMetalFlange (context is Context, id is Id, definition is map)

Create sheet metal flanges on selected edges of sheet metal parts. Length of flange may be defined by distance (as measured from the virtual sharp along outer edge of wall) or limiting entity. Bend angle may be flipped using the oppositeDirection flag. When auto-miter is not selected, flange sides are rotated by miter angle.

sheetMetalFormed
sheetMetalFormed (context is Context, id is Id, definition is map)

Creates forms of specified dimensions and style, based either on standard forms, or by user-defined forms. Each form's position and orientation are specified using sketch points or mate connectors. For sketch points sketch coordinate system specifies orientation.

sheetMetalInFlat
SMFlatOp (context is Context, id is Id, definition is map)

Adds or removes material of sheet metal part as specified by faces attached to its its flat pattern Is the implementation of sheet metal extrude in flat.

Parameter	Type	Additional Info
definition	map	
faces
Query	
Faces associated with sheet metal flat, typically sketch faces or region of sketch in flat

flatOperationType
FlatOperationType	
SMEdgeBlendImpl (context is Context, id is Id, definition is map)

Applies a requested feature in sheet metal flat, changes definition surfaces to reflect this and updates sheet metal geometry Used by fillet and chamfer

Parameter	Type	Additional Info
definition	map	
entities
Query	
Sheet metal edges or vertices (flat selections are allowed) associated with vertices in definition

crossSection
FilletCrossSection	
chamferType
ChamferType	
Required if crossSection is CHAMFER

width
ValueWithUnits	
Required if chamferType is EQUAL_OFFSETS or OFFSET_ANGLE.

width1
ValueWithUnits	
Required if chamferType is TWO_OFFSETS.

width2
ValueWithUnits	
Required if chamferType is TWO_OFFSETS.

angle
ValueWithUnits	
Required if chamferType is OFFSET_ANGLE.

oppositeDirection
boolean	
Optional

radius
ValueWithUnits	
Required if crossSection is CIRCULAR or CONIC or CURVATURE.

isAsymmetric
boolean	
Optional

flipAsymmetric
boolean	
Optional

otherRadius
ValueWithUnits	
Required if isAsymmetric is true.

rho
number	
Required if crossSection is CONIC.

magnitude
number	
Required if crossSection is CURVATURE.

sheetMetalJoint
sheetMetalJoint (context is Context, id is Id, definition is map)

sheetMetalJoint feature modifies sheet metal joint by changing its attribute.

sheetMetalLoft
sheetMetalLoft (context is Context, id is Id, definition is map)

Create or add to existing sheet metal parts by selecting two profiles to loft. Adjust chordal tolerance to change loft resolution. Rips are automatically added to closed profiles. Operations on sheet metal models are automatically represented as a flat pattern, and joints and bends are listed in a table.

sheetMetalMakeJoint
MakeJointType enum

MakeJointType is a subset of SMJointType to restrict options visible in sheetMetalMakeJoint

Value	Description
BEND	
RIP	
sheetMetalMakeJoint (context is Context, id is Id, definition is map)

Produces a sheet metal joint of type RIP or BEND by extending or trimming walls of selected edges. Rip is created as an edge joint by default.

sheetMetalStart
SMProcessType enum

Method of initializing sheet metal model

Value	Description
CONVERT	
EXTRUDE	
THICKEN	
SMCornerStrategyType enum

Default corner relief style setting

Value	Description
SIZED_RECTANGLE	
RECTANGLE	
SIZED_ROUND	
ROUND	
CLOSED	
SIMPLE	
SMBendStrategyType enum

Default bend relief style setting

Value	Description
RECTANGLE	
OBROUND	
TEAR	
SMBendCalculationType enum

Bend calculation setting

Value	Description
K_FACTOR	
BEND_ALLOWANCE	
BEND_DEDUCTION	
CORNER_RELIEF_SCALE_BOUNDS const

Corner relief scale bounds

BEND_RELIEF_DEPTH_SCALE_BOUNDS const

Bend relief depth scale bounds

BEND_RELIEF_WIDTH_SCALE_BOUNDS const

Bend relief width scale bounds

FLIP_DIRECTION_UP_MANIPULATOR_NAME const

Manipulator name for the "flip direction up" manipulator

sheetMetalModelParameters (definition is map) predicate

A predicate containing the parameters required to define all parameters for a sheet metal model.

sheetMetalStart (context is Context, id is Id, definition is map)

Create and activate a sheet metal model by converting existing parts, extruding sketch curves or thickening. All operations on an active sheet metal model will automatically be represented in the flat pattern and the table. Sheet metal models may consist of multiple parts. Multiple sheet metal models can be active.

convertExistingPart (context is Context, id is Id, definition is map)

Convert an existing body into a sheet metal part. Definition should include all parameters from sheetMetalModelParameters.

Parameter	Type	Additional Info
definition	map	
partToConvert
Query	
The body to convert.

facesToExclude
Query	
Input faces to exclude from the sheet metal model.

bends
Query	
Edges to represent as bends in the sheet metal model. All other nonlaminar edges will be converted to rips.

clearance
ValueWithUnits	
Clearance from input.

bendsIncluded
boolean	
If true, bends will be included in clearance calculations.

sheetMetalTab
sheetMetalTab (context is Context, id is Id, definition is map)

Feature adding tabs to parallel sheet metal faces.

sheetMetalUtils
defineSheetMetalFeature (feature is function, defaults is map) returns function

Exposes sheet metal definition sheet body to the queries within feature.

updateSheetMetalGeometry (context is Context, id is Id, args is map)

Based on current state of sheet metal definition sheet body update solid bodies

Parameter	Type	Additional Info
args	map	
entities
Query	
sheet metal definition entities changed (or attributes changed) in this feature

deletedAttributes
array	
associated attributes of deleted sheet metal definition entities

associatedChanges
Query	
sheet metal definition entities representing the change of this feature

SMThicknessDirection enum

Direction of material from definition body. For old models (before V629_SM_MODEL_FRONT_N_BACK) It is BOTH, for new models FRONT/BACK depends on oppositeDirection in sheetMetalStart

Value	Description
BOTH	
FRONT	
BACK	
setCylindricalBendAttribute (context is Context, face is Query, frontThickness is ValueWithUnits, backThickness is ValueWithUnits, attributeId is string)

Set a bend attribute on a cylindrical face

Parameter	Type	Additional Info
face	Query	
face to set bend attribute on

attributeId	string	
id of new bend attribute

annotateSmSurfaceBodies (context is Context, id is Id, args is map, objectCount is number) returns number

Assign SMAttributes to topology of sheet metal definition sheet body

Parameter	Type	Additional Info
args	map	
surfaceBodies
Query	
bendEdgesAndFaces
Query	
specialRadiiBends
array	
array of pairs "(edge, bendRadius)"

defaultRadius
ValueWithUnits	
bend radius to be applied to edges in bendEdgesAndFaces

controlsThickness
boolean	
thickness
ValueWithUnits	
defaultCornerReliefScale
number	
defaultRoundReliefDiameter
ValueWithUnits	
defaultSquareReliefWidth
ValueWithUnits	
defaultBendReliefScale
number	
K_FACTOR_BOUNDS const

A RealBoundSpec for sheet metal K-factor between 0. and 1., defaulting to .45.

ROLLED_K_FACTOR_BOUNDS const

A RealBoundSpec for rolled sheet metal K-factor between 0. and 1., defaulting to .5.

SM_MINIMAL_CLEARANCE_BOUNDS const

A LengthBoundSpec for minimal clearance of sheet metal rips

SM_BEND_RADIUS_BOUNDS const

A LengthBoundSpec for bend radius in sheet metal features

SM_THICKNESS_BOUNDS const

A LengthBoundSpec for thickness in sheet metal features. default to (1/16)" (i.e. steel)

SM_RELIEF_SIZE_BOUNDS const

A LengthBoundSpec for relief size, corners or bend relief, in sheet metal features.

partitionSheetMetalParts (context is Context, allParts is Query)

Partitions allParts into non-sheet metal parts and sheet metal parts. To preserve existing behavior of code the returned non-sm query is exactly the same as what is passed in for non-sm cases and a query is returned for them. The sheet metal results will usually be iterated through and so are returned as a map with the keys being the sheet metal ID and the values being the parts associated with that model.

See also

separateSheetMetalQueries

getActiveSheetMetalId (context is Context, query is Query)

Get the first id of active sheet metal model the entities of query belong to.

getModelParameters (context is Context, model is Query) returns map

Extract sheet metal model parameters in a convenient form

separateSheetMetalQueries (context is Context, targets is Query) returns map

Separates queries which are part of an active sheet metal model (either in the folded model or the flat pattern).

See also

partitionSheetMetalParts

Return	Type	Description
map	
sheetMetalQueries
Query	
targets which are part of an active sheet metal model

nonSheetMetalQueries
Query	
targets which are not part of an active sheet metal model

sheetMetalExtendSheetBodyCall (context is Context, id is Id, definition is map)

Wrapper around opExtendSheetBody used in sheet metal operations to handle remapping of cornerBreak data

sheetMetalEdgeChangeCall (context is Context, id is Id, edges is Query, definition is map)

Wrapper around opEdgeChange used in sheet metal operations to handle remapping of cornerBreak data

sheetMetalDeripCall (context is Context, id is Id, edges is Query)

Wrapper around opEdgeChange used in sheet metal operations to handle remapping of cornerBreak data

getOwnerSMModel (context is Context, selection is Query) returns array

Returns an array of sm models associated with selection in a way that works outside of sheet metal features.

getSMCorrespondingInPart (context is Context, selection is Query, entityType is EntityType) returns Query

Returns a query for all sheet metal part entities of entityType related to the input sheet metal model entities.

collectCornerBreakTracking (context is Context, bodies is Query) returns map

Collect information before adding material which may merge sheet metal walls. The map returned by this function should be passed directly into remapCornerBreaks after making the desired geometry changes.

Only walls which have broken corners are tracked.

Return	Type	Description
map	
wallIdToPersistentWall
map	
a map from wall id to a tracked query for the wall

wallIdToVerticesWithBreaks
array	
a map from wall id to an array of tracked vertices which break the wall

remapCornerBreaks (context is Context, cornerBreakTracking is map)

Remap corner breaks on walls whose wall id has changed. Takes the output of collectCornerBreakTracking as cornerBreakTracking.

getSelectionsForSMDefinitionEntities (context is Context, definitionEntities is Query, originalSelections is Query)

Map a group of sheet metal definition entities back to the original entities selected by the user.

separateByModelVersion (context is Context, targets is Query, version is FeatureScriptVersionNumber) returns map

Separates queries which are part of an active sheet metal model (either in the folded model or the flat pattern) with additional separation of active sheet metal queries based on feature script version of the corresponding sheet metal model.

See also

separateSheetMetalQueries

Return	Type	Description
map	
sheetMetalQueries
Query	
targets which are part of an active sheet metal model

nonSheetMetalQueries
Query	
targets which are not part of an active sheet metal model

legacyModelQueries
Query	
targets which are part of an active sheet metal model with fsVersion earlier than version

newModelQueries
Query	
targets which are part of an active sheet metal model with fsVersion equal or later than version

prepareInitialArcSketch (wrapAroundFront is boolean, modelParameters is map, innerRadius is ValueWithUnits, angle is ValueWithUnits) returns map

Prepare to sketch the initial arc of the hem or flange, starting at the selected edge and wrapping either around the front of the back of the sheet. Returns information about arc ids and arc end position.

getDefaultBendReliefWidth (context is Context, model is Query) returns ValueWithUnits

Returns the width of a default bend relief for a sheet metal model. In the case of a tear, returns the minimal clearance.

shell
shell (context is Context, id is Id, definition is map)

Feature performing an opShell.

splitpart
SplitType enum

Defines whether a split should split whole parts, or just faces.

Value	Description
PART	
FACE	
splitPart (context is Context, id is Id, definition is map)

Feature performing an opSplitPart.

sweep
sweep (context is Context, id is Id, definition is map)

Feature performing an opSweep, followed by an opBoolean. For simple sweeps, prefer using opSweep directly.

tag
TagPurpose enum

Defines the kind of entity being tagged in the feature.

Value	Description
FRAME	
Tag a frame profile with metadata. The metadata will be displayed in the cut list for frames derived from the tagged profile.

FORM	
Tag a form with metadata. The metadata will be used for formed features derived from the form.

PCB_HOLES	
Tag holes or cutouts with ECAD metadata. The metadata will be used for importing to PCB Studio.

PcbEntityType enum

Type of PCB entities being tagged by a Tag feature.

Value	Description
HOLE	
Entities will be imported as holes in PCB Studio.

CUTOUT	
Entities will be imported as cutouts in PCB Studio.

PcbPlatedHolePurpose enum

Predefined purpose values for a plated PCB hole tagged by a Tag feature.

Value	Description
NONE	
No purpose specified.

VIA	
Hole is associated with a conductive via.

THERMAL_VIA	
Hole is associated with a thermal via.

PIN	
Hole is associated with a component pin.

CUSTOM	
User-defined purpose.

PcbNonPlatedHolePurpose enum

Predefined purpose values for a non-plated PCB hole tagged by a Tag feature.

Value	Description
NONE	
No purpose specified.

MOUNTING	
Hole is used for mounting purposes.

TOOLING	
Hole is used for tooling purposes.

CUSTOM	
User-defined purpose.

PcbHoleOwner enum

Owner of a PCB hole tagged by a Tag feature.

Value	Description
UNOWNED	
Hole can be modified in either system.

ECAD	
Hole is owned by the Electrical system and should not be modified in the Mechanical system.

MCAD	
Hole is owned by the Mechanical system and should not be modified in the Electrical system.

tag (context is Context, id is Id, definition is map)

Tag an entity with metadata. The metadata will be used for formed and frame features or imported to PCB Studio.

thicken
thicken (context is Context, id is Id, definition is map)

Feature performing an opThicken, followed by an opBoolean. For simple thickens, prefer using opThicken directly.

transformCopy
TransformType enum

Defines how a the transform for a transform feature should be specified. SCALE_UNIFORMLY actually also supports non-uniform scaling.

Value	Description
TRANSLATION_ENTITY	
TRANSLATION_DISTANCE	
TRANSLATION_3D	
TRANSFORM_MATE_CONNECTORS	
ROTATION	
COPY	
SCALE_UNIFORMLY	
transform (context is Context, id is Id, definition is map)

Move and/or rotate bodies or mate connectors with a single Transform, constructed with input according to the selected TransformType.

Internally, performs an opTransform when not copying, and an opPattern when copying. For simple transforms, prefer calling opTransform or opPattern directly.

Parameter	Type	Additional Info
definition	map	
entities
Query	
The bodies or mate connectors to transform. An error is thrown if anything else is included.

EXAMPLE

qCreatedBy(id + "extrude1", EntityType.BODY)
transformType
TransformType	
Defines how the transform type should be specified.

EXAMPLE

TransformType.TRANSLATION_3D
dx
ValueWithUnits	
Required if transformType is TransformType.TRANSLATION_3D

A value with length units specifying the distance to move in the world x direction.

EXAMPLE

1 * inch
dy
ValueWithUnits	
Required if transformType is TransformType.TRANSLATION_3D

A value with length units specifying the distance to move in the world y direction.

EXAMPLE

1 * inch
dz
ValueWithUnits	
Required if transformType is TransformType.TRANSLATION_3D

A value with length units specifying the distance to move in the world z direction.

EXAMPLE

1 * inch
transformLine
Query	
Required if transformType is TransformType.TRANSLATION_ENTITY

A Query for either a single line or a pair of points, specifying the direction and distance to transform.

oppositeDirectionEntity
boolean	
Required if transformType is TransformType.TRANSLATION_ENTITY

EXAMPLE

true to flip the transform direction.
transformAxis
Query	
Required if transformType is TransformType.ROTATION

A Query for a line, cylinder, etc. to specify the transform direction.

angle
ValueWithUnits	
Required if transformType is TransformType.ROTATION

A value with angle units specifying the angle to rotate.

transformDirection
Query	
Required if transformType is TransformType.TRANSLATION_DISTANCE

A Query for either a single line or a pair of points, specifying the direction to transform.

distance
ValueWithUnits	
Required if transformType is TransformType.TRANSLATION_DISTANCE

A value with length units specifying the distance to move.

oppositeDirection
boolean	
Required if transformType is TransformType.TRANSLATION_DISTANCE or TransformType.ROTATION

EXAMPLE

true to transform in the opposite direction.
uniform
boolean	
Optional

True if the scale is uniform in all directions (default)

scale
number	
Required if transformType is TransformType.SCALE_UNIFORMLY and uniform is true

A positive real number specifying the scale factor.

scalePoint
Query	
Required if transformType is TransformType.SCALE_UNIFORMLY

A point specifying the center of the scale or a mate connector specifying the coordinate system for a non-uniform scale.

scaleX
number	
Required if transformType is TransformType.SCALE_UNIFORMLY and uniform is false

scaleY
number	
Required if transformType is TransformType.SCALE_UNIFORMLY and uniform is false

scaleZ
number	
Required if transformType is TransformType.SCALE_UNIFORMLY and uniform is false

baseConnector
Query	
Required if transformType is TransformType.TRANSFORM_MATE_CONNECTORS

The mate connector to transform from.

destinationConnector
Query	
Required if transformType is TransformType.TRANSFORM_MATE_CONNECTORS

The mate connector to transform to.

oppositeDirectionMateAxis
boolean	
Required if transformType is TransformType.TRANSFORM_MATE_CONNECTORS

secondaryAxisType
MateConnectorAxisType	
Required if transformType is TransformType.TRANSFORM_MATE_CONNECTORS

makeCopy
boolean	
Required if transformType is not TransformType.COPY

EXAMPLE

true to keep the original bodies.
copyPart (context is Context, id is Id, definition is map)

Deprecated: Use opPattern, or the transform feature instead.

variable
VariableMode enum

Whether the variable is measured, assigned or from table.

Value	Description
ASSIGNED	
MEASURED	
TABLE	
VariableMeasurementMode enum

Whether to measure distance or length.

Value	Description
DISTANCE	
LENGTH	
DIAMETER	
AxisWithCustom enum

Axis selection

Value	Description
DISTANCE	
X	
Y	
Z	
CUSTOM	
VariableMinMaxSelection enum

Min or max selection

Value	Description
MINIMUM	
MAXIMUM	
AccessType enum

Whether the accessType is by index, by index range, by label or all values

Value	Description
INDEX	
INDEX_RANGE	
LABEL	
ALL	
ResultType enum

Whether result type is single value, array or map

Value	Description
SINGLE	
ARRAY	
MAP	
TABLE_INDEX_BOUNDS const

table index bounds

assignVariable (context is Context, id is Id, definition is map)

Feature performing a setVariable allowing a user to assign a FeatureScript value to a context variable. This variable may be retrieved within a feature by calling getVariable, or in a Part Studio using # syntax (e.g. #foo) inside any parameter which allows an expression (including the value parameter of another variable!)

Parameter	Type	Additional Info
definition	map	
mode
VariableMode	
Whether the variable is measured, assigned or from import.

name
string	
Must be an identifier.

description
string	
Description of the variable. Maximum length of 256 characters.

variableType
VariableType	
The type of variable. If it is not ANY, the value is restricted to be a length, angle, or number and is passed through the lengthValue, angleValue, or numberValue field, respectively.

lengthValue
ValueWithUnits	
Used if variableType is LENGTH.

angleValue
ValueWithUnits	
Used if variableType is ANGLE.

numberValue
number	
Used if variableType is NUMBER.

anyValue
Used if variableType is ANY. Can be any immutable FeatureScript value, including a length, an array, or a function.

measurementMode
VariableMeasurementMode	
Whether to measure distance, length, or diameter.

entityCouple
Query	
Query for distance mode, containing two entities to measure the distance between.

minmax
VariableMinMaxSelection	
Whether to measure the minimum or maximum distance.

axis
AxisWithCustom	
Axis to measure distance along.

extendEntities
boolean	
Extend selected planes and lines out to infinity. Incompatible with maximum.

measureFromAxis
boolean	
Measure from the axis of geometry with an axis, rather than from the edge. Incompatible with maximum.

componentSelector
AxisWithCustom	
Select an axis to measure along.

customDirection
Query	
If componentSelector is CUSTOM, a query containing geometry with a directon to measure along.

lengthEntities
Query	
Query for length mode, containing entities to measure the length of.

radius
boolean	
Whether to measure the radius rather than the diameter.

diameterEntity
Query	
Query for diameter mode, containing an entity to measure the diameter of.

verifyVariableNameIsValid (name is string, faultyParameter is string)

Throws an error if name is not a valid identifier.

verifyVariableName (context is Context, name is string, faultyParameter is string)

Throws an error if name is not a valid identifier or is used by a query variable.

makeLookupFunction (context is Context, id is Id) returns function

Make a function to look up variables from the given context. Used in generated part studio code.

measureDistance (context is Context, arg is map) returns map

Measure the distance between two entities.

Parameter	Type	Additional Info
arg	map	
entities
Query	
a query containing two entities to measure the distance between.

measureFromAxis
boolean	
Optional

measure from the axis of the selected geometry, if an axis is available. Incompatible with the maximum option. Defaults to false.

customDirection
Query	
Optional

measure the distance between two entities along a direction selected by this query.

extendEntities
boolean	
Optional

extend the entities out to infinity. Incompatible with the maximum option. Defaults to false.

maximum
boolean	
Optional

measure the maximum distance between the selected entities, instead of the minimum by default. Defaults to false.

selectDistanceComponent (distanceMap is map, componentSelector is AxisWithCustom)

Returns appropriate entry in distanceMap returned from measureDistance given the selected AxisWithCustom.

measureDiameter (context is Context, arg is map)

Measure the diameter (or radius) of the selected entity.

Parameter	Type	Additional Info
arg	map	
entity
Query	
a query containing an entity of GeometryType.CIRCLE, GeometryType.ARC, GeometryType.CYLINDER, or GeometryType.SPHERE.

radius
boolean	
Optional

measure the radius instead of the diameter. Defaults to false.

wrap
WrapResultType enum

Defines what type of output the Wrap feature should produce.

Value	Description
SOLID	
The wrap operation will produce thickened solid bodies.

SURFACE	
The wrap operation will produce surface bodies.

IMPRINT	
The wrap operation will imprint edges onto the destination face.

wrap (context is Context, id is Id, definition is map)

Feature performing an opWrap.

enums
annotationdimensiondirection
AnnotationDimensionDirection enum

Used to specify the measurement direction for annotation dimensions.

Value	Description
DEFAULT	
GLOBAL_X	
GLOBAL_Y	
SPECIFIC	
blendcontroltype
BlendControlType enum

Specifies the controlled quantitiy for fillet operation.

Value	Description
RADIUS	
WIDTH	
bodydraftconcaverepairtype
BodyDraftConcaveRepairType enum

Specifies how to repair miter at concave corners.

Value	Description
NONE	
RADIUS	
MIX	
bodydraftcornertype
BodyDraftCornerType enum

Specifies how to fill the gap between adjacent tapered faces.

Value	Description
EXTEND	
PLANE	
bodydraftmatchfacetype
BodyDraftMatchFaceType enum

Specifies how to match drafted faces.

Value	Description
TANGENT_TO_FACE	
REFERENCE_EDGE	
bodydraftselectiontype
BodyDraftSelectionType enum

Specifies the topology type for body draft.

Value	Description
PARTS	
FACES	
EDGES	
booleanoperationtype
BooleanOperationType enum

See opBoolean.

Value	Description
UNION	
SUBTRACTION	
INTERSECTION	
SUBTRACT_COMPLEMENT	
boundingtype
BoundingType enum

Specifies how an extrude should terminate.

Value	Description
BLIND	
Extrude a specific distance.

UP_TO_NEXT	
Extrude up to the next solid body or surface body in the context.

UP_TO_SURFACE	
Extrude up to the specified face, construction plane, or surface body.

UP_TO_BODY	
Extrude up to the specified solid body.

UP_TO_VERTEX	
Extrude up to the specified vertex.

THROUGH_ALL	
Extrude an unspecified distance, guaranteed to be further in the extrude direction than any other solid or surface in the context.

UP_TO_FACE	
chamfermethod
ChamferMethod enum

See opChamfer.

Value	Description
FACE_OFFSET	
APEX_RANGE	
chamfertype
ChamferType enum

See opChamfer.

Value	Description
EQUAL_OFFSETS	
TWO_OFFSETS	
OFFSET_ANGLE	
RAW_OFFSET	
clashtype
ClashType enum

Specifies the class of intersection between two bodies.

See also

evCollision

Value	Description
NONE	
No intersection.

INTERFERE	
Bounding topologies interfere.

EXISTS	
Vertex or edge intersection. Returned only during collisions between two (1-dimensional) curves.

ABUT_NO_CLASS	
Bounding topologies abut.

ABUT_TOOL_IN_TARGET	
Bounding tool abuts bounding target on inside.

ABUT_TOOL_OUT_TARGET	
Bounding tool abuts bounding target on outside.

TARGET_IN_TOOL	
Target completely inside tool.

TOOL_IN_TARGET	
Tool completely inside target.

constrainttype
ConstraintType enum

Specifies a type of sketch constraint.

See also

skConstraint

Value	Description
NONE	
COINCIDENT	
PARALLEL	
VERTICAL	
HORIZONTAL	
PERPENDICULAR	
CONCENTRIC	
MIRROR	
MIDPOINT	
TANGENT	
EQUAL	
LENGTH	
DISTANCE	
ANGLE	
RADIUS	
NORMAL	
FIX	
PROJECTED	
OFFSET	
CIRCULAR_PATTERN	
PIERCE	
LINEAR_PATTERN	
MAJOR_DIAMETER	
MINOR_DIAMETER	
QUADRANT	
DIAMETER	
SILHOUETTED	
CENTERLINE_DIMENSION	
INTERSECTED	
RHO	
EQUAL_CURVATURE	
BEZIER_DEGREE	
FREEZE	
coordinatesysteminferenceselectionfilter
CoordinateSystemInferenceSelectionFilter enum

Specifies the filter type when requesting inference mate connectors.

Value	Description
NONE	
HOLE_GEOMETRY	
curveextensionendcondition
CurveExtensionEndCondition enum

Specifies the end condition for curve extension.

Value	Description
BLIND	
UP_TO_ENTITY	
curveextensionshape
CurveExtensionShape enum

Specifies the shape of curve extension.

Value	Description
CURVATURE	
TANGENT	
curvepatternorientationtype
CurvePatternOrientationType enum

Specifies the orientation type of patterned entities in curve pattern.

Value	Description
DEFAULT	
Patterned entities will be reoriented tangent to curve (default orientation).

LOCK_FACES	
Lock the orientation of patterned entities normal to a set of faces.

KEEP_ORIENTATION	
Match the orientation of patterned entities with the seed entity orientation.

curvetype
CurveType enum

The subset of GeometryType which applies to 1-dimensional entities.

Value	Description
CIRCLE	
LINE	
OTHER	
ELLIPSE	
SPLINE	
debugcolor
DebugColor enum

Color choices for the debug function

Value	Description
RED	
GREEN	
BLUE	
CYAN	
MAGENTA	
YELLOW	
BLACK	
ORANGE	
dimensionalignment
DimensionAlignment enum

Specifies how a constraint between lines or axes (such as parallel or coincident) should align the two constrained axes.

Value	Description
UNSPECIFIED	
ALIGNED	
ANTI_ALIGNED	
dimensionmeasurementreferencetype
DimensionMeasurementReferenceType enum

Used to specify how to measure the distance between cylindrical faces or between a cylindrical face and a plane, as in setDimensionedEntities.

Value	Description
AXIS	
Measure to the axis of the cylinder.

MINIMUM	
Measure to the minimum extent of the cylinder.

MAXIMUM	
Measure to the maximum extent of the cylinder.

drafttype
DraftType enum

Specifies the type of draft to execute.

Value	Description
REFERENCE_ENTITY	
Draft faces holding a specific reference entity constant for each face.

REFERENCE_SURFACE	
Draft faces relative to a single neutral surface.

edgeconvexitytype
EdgeConvexityType enum

Specifies how two faces join at a given edge. This is a function of the interior angle between the adjoining surfaces, measured inside the owner body.

Value	Description
CONVEX	
The interior angle is less than 180 degrees along the whole edge.

CONCAVE	
The interior angle is greater than 180 degrees along the whole edge.

SMOOTH	
The interior angle is equal to 180 degrees along the whole edge.

VARIABLE	
None of the above, i.e. the edge convexity varies along the edge.

edgetopology
EdgeTopology enum

Specifies the topology of an edge entity.

Can be used in a filter on a query parameter to only allow certain selections:

 annotation { "Name" : "Surface edges", "Filter" : EntityType.EDGE && EdgeTopology.ONE_SIDED } definition.edges is Query; 
See also

qEdgeTopologyFilter

Value	Description
WIRE	
edge without adjacent faces, belonging to a wire body.

ONE_SIDED	
An edge adjacent to one face (e.g. the edge of a surface extrude).

TWO_SIDED	
An edge which joins two faces (e.g. the edge of a cube).

entityinferencetype
EntityInferenceType enum

Specifies how a mate connector's coordinate system is defined with respect to an entity.

See also

mateConnector

Value	Description
POINT	
Place a mate connector at a vertex with the world coordinate system, or at the tip of a conical face with its Z-axis along the cone axis.

CENTROID	
Place a mate connector at the centroid of a face, with its Z-axis along the face normal at that point.

CENTER	
Place a mate connector at the center of a circular or elliptical edge with its Z-axis along the normal of the plane which the edge lies on, or at the center of a sphere with the world coordinate system.

MID_POINT	
Place a mate connector at the midpoint of an edge, with its Z-axis along the edge.

TOP_AXIS_POINT	
Place a mate connector at the projection of the top extreme of a cylindrical or other revolved face onto the central axis of that face, with its Z-axis along the central axis.

MID_AXIS_POINT	
Place a mate connector at the projection of the point midway betwen the top and bottom extremes of a cylindrical or other revolved face onto the central axis of that face, with its Z-axis along the central axis.

BOTTOM_AXIS_POINT	
Place a mate connector at the projection of the bottom extreme of a cylindrical or other revolved face onto the central axis of that face, with

LOOP_CENTER	
Place a mate connector at the center of a loop of planar edges, with its Z-axis along the normal of the plane. Only one edge of the loop needs to be selected for this inference.

VIRTUAL_SHARP	
Place a mate connector at locations along a loop of planar edges where a single nonlinear edge sits between two nonparallel lines and is tangent to both. The mate origin will be the projected intersection of the two lines, with its Z-axis along the normal of the plane.

extendendtype
ExtendEndType enum

See opExtendSheetBody.

Value	Description
EXTEND_BLIND	
EXTEND_TO_TARGET	
extendsheetshapetype
ExtendSheetShapeType enum

See opExtendSheetBody.

Value	Description
LINEAR	
SOFT	
faceblendcrosssection
FaceBlendCrossSection enum

Specifies the type of cross section of the blend.

Value	Description
ROLLING_BALL	
SWEPT_PROFILE	
faceblendcrosssectionshape
FaceBlendCrossSectionShape enum

Specifies the cross sectional control for a fillet operation.

Value	Description
CIRCULAR	
CONIC	
CURVATURE	
CHAMFER	
faceblendpropagation
FaceBlendPropagation enum

Specifies the propagation type of the blend.

Value	Description
TANGENT	
ADJACENT	
CUSTOM	
faceblendtrimtype
FaceBlendTrimType enum

Specifies how to trim the created blend.

Value	Description
WALLS	
SHORT	
LONG	
NO_TRIM	
facecurvecreationtype
FaceCurveCreationType enum

Specifies type of curve on face.

See also

opCreateCurvesOnFace

Value	Description
DIR1_ISO	
Iso-parameter curves in primary direction

DIR2_ISO	
Iso-parameter curves in secondary direction.

DIR1_AUTO_SPACED_ISO	
Equally spaced iso-parameter curves in primary direction.

DIR2_AUTO_SPACED_ISO	
Equally spaced iso-parameter curves in secondary direction.

faulttype
FaultType enum

Description of possible faults.

Value	Description
NO_FAULT	
CORRUPT_ENTITY	
BODY_INVALID_IDENTIFIERS	
BODY_INSIDE_OUT	
EDGE_OPEN	
EDGE_BAD_VERTEX	
EDGE_REVERSED	
VERTICES_TOUCH	
WIRE_INTERSECT	
ENTITY_INVALID	
FACE_BAD_VERTEX	
FACE_BAD_EDGE	
FACE_INTERSECTS_EDGE	
CHECKING_FAILED	
FACE_FACE_INTERSECTION	
SELF_INTERSECTION	
ENTITY_NOT_G1	
BOUNDING_BOX_VIOLATION	
NO_GEOMETRY	
UNDEFINED_FACE_SENSE	
TOLERANCE_TOO_SMALL	
EDGES_TOUCH	
DEGENERATE_GEOMETRY	
GENERAL_FAULT	
featuredimensiontype
FeatureDimensionType enum

Used to specify the type of a feature dimension, as in setDimensionedEntities.

Value	Description
DISTANCE	
Indicates the distance between two faces.

ANGLE	
Indicates the angle between two planar faces.

RADIUS	
Indicates the radius of a face with a circular cross-section of consistent radius, e.g. cylinder, torus.

DIAMETER	
Indicates the diameter of a face with a circular cross-section of consistent radius.

AXIS_DISTANCE	
Indicates the distance between the axes of two faces (cones or cylinders), or the distance between one such face and a planar face.

fieldweldflag
FieldWeldFlag enum

Enum to determine whether we should display no flag, upper flag or lower flag.

Value	Description
NONE	
UPPER	
LOWER	
filletcrosssection
FilletCrossSection enum

Specifies the cross sectional control for a fillet operation.

Value	Description
CIRCULAR	
CONIC	
CURVATURE	
CHAMFER	
fittolerancetables
getFitToleranceLimits (nominalSize is ValueWithUnits, standard is string, toleranceClass is string, isHoleBasis is boolean) returns map

Retrieves fit tolerance limits for a given nominal size, tolerance class, and basis.

Parameter	Type	Additional Info
nominalSize	ValueWithUnits	
The nominal size with units for which the fit tolerance limits are required.

standard	string	
The standard of the fit tolerance table ("ANSI" or "ISO").

toleranceClass	string	
The tolerance class as a string.

isHoleBasis	boolean	
Indicates whether the basis of the tolerance class is hole or shaft.

Return type	Description
map	
A map containing the fit tolerance limits. Returns an empty map if no suitable tolerance limits are found.

fixedparameterposition
FixedParameterPosition enum

Specifies where a constraint should be resolved FIXED_AT_START or FIXED_AT_END will fix the constraint to coincide with the start or end of parametric curves. FIXED_ON_CURVE will fix the help point.

Value	Description
FIXED_AT_START	
FIXED_AT_END	
FIXED_ON_CURVE	
FREE	
geometriccontinuity
GeometricContinuity enum

Specifies the level of geometric continuity.

Value	Description
G0	
G1	
G2	
holepositionreference
HolePositionReference enum

For a HoleProfile, a reference point along the hole axis to which the position of the profile is relative. To calculate these references, the cylinder of the hole is intersected with the targets of the hole. If the hole cylinder encounters a slanted or otherwise irregular face at the intersection with the target, the reference may by a range rather than a single point. Users may specify that they want the end of this range by using a holeProfile, or the beginning of this range by using a holeProfileBeforeReference; or they may control this behavior directly by setting the beforeReference flag of the HoleProfile.

Typically, the beginning of the reference range should be used for the first profile of the hole, and the end of the reference range should be used for the rest of the profiles of the hole. Using the beginning of the reference range for the first profile ensures that when the hole tool is cut from a target with a slanted or otherwise irregular entrance face, the first profile is far back enough to ensure that no undesirable overhang is left behind on the target, preventing the fastener from entering the hole. Using the end of the reference range for the rest of the profiles ensures that any nominal distances are measured from where the hole cylinder fully enters the part. As an example of both of these concepts, set the first two profiles of a HoleDefinition as a holeProfileBeforeReference referencing TARGET_START with a position of 0 inches, and a holeProfile referencing TARGET_START with a position of 2 inches, respectively. If this layout of profiles is used against a target that has a slanted entrance face, the first profile will be placed right where the cylinder first intersects the part, ensuring that there is no overhang when the hole tool is subtracted from the target. The second profile will be placed 2 inches from where the hole cylinder fully enters the target, such that the request for the hole to be 2 inches deep is understood as the hole having a full two inches of depth in the target, exluding the area where the hole is only partially cut into the target. Notably, to accomplish this the first and second profiles are placed more than two inches apart.

When calculating references, any intersection which is fully behind the origin of the axis Line (i.e. the axis point) is always ignored. Range intersections where the end of the range is ahead of the axis point but the start of the range is behind the axis point are not ignored.

Value	Description
AXIS_POINT	
When calling opHole, the user will supply one or more axes defining where the holes are to be placed. When using this reference, the position of the profile will be in reference to the origin of the axis Line of the hole.

TARGET_START	
When using this reference, the position of the profile will be in reference to the closest intersection of the hole cylinder with any target.

LAST_TARGET_START	
For each target, find the first intersection of the hole cylinder into the target. When using this reference, the position of the profile will be in reference to the furthest of those intersections. Notably, this means that if certain targets are geometrically constructed such that the hole cylinder enters and exits the target multiple times, only the first of the entrances into the target is considered.

LAST_TARGET_END	
When using this reference, the position of the profile will be in reference to the furthest exit of the hole cylinder from any target.

UP_TO_ENTITY	
UP_TO_NEXT	
LAST_TARGET_START_IN_DEPTH	
For each target, find the first intersection of the hole cylinder into the target. When using this reference, the position of the profile will be in reference to the furthest of those intersections within the hole depth.

holeprofiletype
HoleProfileType enum

Describes how a HoleProfile is constructed in relation to its HolePositionReference.

Value	Description
POSITIONED	
See holeProfile.

MATCHED	
See matchedHoleProfile.

icon
Icon enum

Specifies an icon resource available in Onshape.

Value	Description
X_LINEAR_LIMIT_MIN	
Minimum X linear limit.

X_LINEAR_LIMIT_MAX	
Maximum X linear limit.

Y_LINEAR_LIMIT_MIN	
Minimum Y linear limit.

Y_LINEAR_LIMIT_MAX	
Maximum Y linear limit.

Z_LINEAR_LIMIT_MIN	
Minimum Z linear limit.

Z_LINEAR_LIMIT_MAX	
Maximum Z linear limit.

X_ROTATION_LIMIT_MIN	
Minimum X rotation limit.

X_ROTATION_LIMIT_MAX	
Maximum X rotation limit.

Y_ROTATION_LIMIT_MIN	
Minimum Y rotation limit.

Y_ROTATION_LIMIT_MAX	
Maximum Y rotation limit.

Z_ROTATION_LIMIT_MIN	
Minimum Z rotation limit.

Z_ROTATION_LIMIT_MAX	
Maximum Z rotation limit.

CONE_ANGLE_LIMIT	
Cone angle limit.

HOLE_DIAMETER	
Hole diameter.

HOLE_DEPTH	
Hole depth.

HOLE_DRILL_ANGLE	
Hole drill angle.

HOLE_COUNTERBORE_DIAMETER	
Hole counterbore diameter.

HOLE_COUNTERBORE_DEPTH	
Hole counterbore depth.

HOLE_COUNTERSINK_DIAMETER	
Hole countersink diameter.

HOLE_TAP_DIAMETER	
Hole tap diameter.

HOLE_COUNTERSINK_ANGLE	
Hole countersink angle.

HOLE_TAPPED_DEPTH	
Hole tapped depth.

HOLE_TAP_CLEARANCE	
Hole tap clearance.

ALONG_X	
Along the X-axis.

ALONG_Y	
Along the Y-axis.

ALONG_Z	
Along the Z-axis.

DOF_TRANSLATION	
Degrees of freedom translation.

DOF_ROTATION	
Degrees of freedom rotation.

DIHEDRAL_LOW	
Dihedral low.

DIHEDRAL_HIGH	
Dihedral high.

lofttopology
LoftTopology enum

Specifies topology option for opLoft.

Value	Description
MINIMAL	
Minimal number of faces created.

COLUMNS	
One face is created for each matching set of profile segments.

GRID	
Faces created for COLUMNS option are split at each profile.

lookupTablePath
LookupTablePath type

A LookupTablePath identifies a map of keys into a multi-level table.

The fields on a LookupTablePath depend on its related LookupTable.

Value	Type	Description
LookupTablePath	map	
entityType
EntityType	
Optional

canBeLookupTablePath (value) predicate

Typecheck for LookupTablePath

lookupTablePath (source is map) returns LookupTablePath

Creates a lookupTablePath.

lookupTableEvaluate (expression is string) returns ValueWithUnits

Convert a table expression in string form into a ValueWithUnits.

Parameter	Type	Additional Info
expression	string	
Currently the following forms are supported:

EXAMPLE

{number} <*> {units}
EXAMPLE

{number}/{number} <*> {units}
EXAMPLE

{number} <+> {number}/{number} <*> {units} Where {number} is <-><.>nnn> or <->inf
EXAMPLE

{} indicate an entity, <> indicate the contents are optional spaces between entities are optional unless they are required to separate entities.
lookupTableFixExpression (expression is string) returns string

insert plus sign and parenthesis as needed to make a valid expression

getLookupTable (table is map, path is LookupTablePath)

Find a terminal/content table from a path and convert into expression/value form

lookupTableGetValue (value) returns ValueWithUnits

Extract the value portion of expression/value maps or evaluate expressions. value maybe an expression or a value with units

isLookupTableViolated (definition is map, table is map) returns boolean

Test if the current definition violates the table.

manipulatordragtypeenum
ManipulatorDragTypeEnum enum

Specifies the type of manipulator being dragged.

Value	Description
NONE	
LINEAR_X	
LINEAR_Y	
LINEAR_Z	
PLANAR_XY	
PLANAR_XZ	
PLANAR_YZ	
ROTATION_X	
ROTATION_Y	
ROTATION_Z	
REPOSITION	
manipulatorstyleenum
ManipulatorStyleEnum enum

Specifies the style of a manipulator intended to look unique.

See also

addManipulators

Value	Description
DEFAULT	
the standard display of the manipulator. *

SECONDARY	
the angular or linear manipulator has two arrow heads. *

SIMPLE	
the display of the angular or linear manipulator is simpler. *

TANGENTIAL	
the linear manipulator has two smaller arrows around a circular base.

manipulatortype
ManipulatorType enum

Specifies a specific type of interactive manipulator.

Value	Description
LINEAR_1D	
A single arrow which can move along a single axis. See extrude for an example.

LINEAR_3D	
A triad of perpendicular arrows which specify a 3D position. See transformCopy for an example.

ANGULAR	
A curved arrow, with two radii, which can move along a circumference to specify an angle. See revolve for an example.

FLIP	
A static arrow which can be clicked to toggle a flip direction. See extrude (with BoundingType.THROUGH_ALL) for an example.

POINTS	
A series of points which can be selected one at a time.

TOGGLE_POINTS	
A series of points which can each be selected individually.

TRIAD_FULL	
A triad of perpendicular arrows, planar and angular manipulators.

mateconnectoraxistype
MateConnectorAxisType enum

Defines what direction the X-axis of a mate connector should face, relative to the reference defined. Thus, a mate connector defined with PLUS_Y will differ from the selected coordinate system by a 90-degree rotation about that coordinate system's Z-axis.

Value	Description
PLUS_X	
PLUS_Y	
MINUS_X	
MINUS_Y	
matedoftype
MateDOFType enum

Specifies a single degree of freedom of a mate.

Value	Description
Tx	
Translation along the X axis.

Ty	
Translation along the Y axis.

Tz	
Translation along the Z axis.

Rz	
Rotation around the Z axis.

Ryp	
Rotation around the transformed Y axis from previous transform sequence.

Rzp	
Rotation around the transformed z axis from previous transform sequence .

movecurveboundarytype
MoveCurveBoundaryType enum

Specifies whether to trim or extend the curve.

Value	Description
TRIM	
EXTEND	
offsetcurvetype
OffsetCurveType enum

Defines what kind of offset distance is used in offset curve on face.

Value	Description
GEODESIC	
The distance is calculated along the faces of the body in which the selected edges lie in.

EUCLIDEAN	
The distance is the distance in world coordinates.

origincreationtype
OriginCreationType enum

Specifies how a mate connector origin is defined, and how many entities define it.

Value	Description
ON_ENTITY	
BETWEEN_ENTITIES	
partstudioitemtype
PartStudioItemType enum

Enumeration of the types of items that can be selected inside a Part Studio reference parameter. By default this parameter allows selecting all of the item types below. It can be filtered by specifying a union of any number of PartStudioItemTypes (e.g. "Filter" : PartStudioItemType.SOLID || PartStudioItemType.ENTIRE_PART_STUDIO) in the parameter's annotation.

Value	Description
SOLID	
A body with BodyType.SOLID (i.e. a part in the parts list)

SURFACE	
A non-sketch body with BodyType.SURFACE (i.e. a surface in the parts list)

WIRE	
A non-sketch body with BodyType.WIRE (i.e. a curve in the parts list)

MESH	
An imported mesh (i.e. a mesh in the parts list)

SKETCH	
An entire sketch feature (i.e. all POINT, WIRE, and SURFACE bodies created by the sketch)

FLATTENED_SHEET_METAL	
A flattened sheet metal part (available from any Part Studio with sheet metal features)

ENTIRE_PART_STUDIO	
The entire Part Studio. Setting this option allows clicking the top item (with the full Part Studio's tumbnail and name), which sets the partQuery to qEverything(EntityType.BODY).

CONSTRUCTION_PLANE	
A plane created with Plane feature or with opPlane

COMPOSITE_PART	
profilecontrolmode
ProfileControlMode enum

Specifies how a profile should be controlled while sweeping.

Value	Description
NONE	
No additional profile control.

KEEP_ORIENTATION	
Keep the orientation constant.

LOCK_FACES	
Lock the sweep operation to a set of faces.

LOCK_DIRECTION	
Lock the sweep operation to a direction.:

projectiontype
ProjectionType enum

See opDropCurve.

Value	Description
DIRECTION	
NORMAL_TO_TARGET	
propertytype
PropertyType enum

Defines the type of property that is being applied to a part.

Value	Description
NAME	
MATERIAL	
APPEARANCE	
DESCRIPTION	
PART_NUMBER	
VENDOR	
PROJECT	
PRODUCT_LINE	
TITLE_1	
TITLE_2	
TITLE_3	
EXCLUDE_FROM_BOM	
CUSTOM	
Requires a custom property id to specify fully.

MASS_OVERRIDE	
REVISION	
recordpatterntype
RecordPatternType enum

Allows differentiation of patterns in computed data

Value	Description
NONE	
LINEAR	
CIRCULAR	
CURVE	
TRANSFORM	
MIRROR	
INSTANTIATED	
rotationtype
RotationType enum

Specifies an axis for rotation.

Value	Description
ABOUT_X	
ABOUT_Y	
ABOUT_Z	
ruledsurfacecornertype
RuledSurfaceCornerType enum

Describes how a Ruled Surface creates corners.

Value	Description
SPUN	
Conical corners are created by spinning an edge.

EXTENDED	
Ruled surfaces are altered so that they meet at corners.

LOFTED	
Curvature continuous lofts are created patching corners.

NO_CORNER	
Leave corners open.

ruledsurfacetype
RuledSurfaceType enum

Describes how a Ruled Surface is defined.

Value	Description
ANGLE_FROM_FACE	
Ruled surface is perpendicular to reference faces.

ALIGNED_WITH_VECTOR	
Ruled surface is in direction of reference direction.

ANGLE_FROM_VECTOR	
Ruled surface will meet a reference direction at an angle when viewed from the path tangent direction.

sectionpart
sectionPart (context is Context, id is Id, definition is map)

Feature creating a section of a part behind a plane. Internally, performs an opSplitPart followed by an opDeleteBodies.

Not exposed in the Part Studio UI.

planeSectionPart (context is Context, id is Id, definition is map)

Split a set of parts with a plane and delete all bodies in front of the face. Unlike sectionPart, bodies which are entirely behind the split plane are retained. Any bodies not included in the target query are deleted.

Parameter	Type	Additional Info
definition	map	
target
Query	
Bodies to be split.

plane
Plane	
Plane that splits the bodies. Everything on the positive z side of the plane will be removed.

multiplePlaneSectionPart (context is Context, id is Id, definition is map)

Split a set of parts with multiple planes and delete all bodies in front of the faces.

Parameter	Type	Additional Info
definition	map	
target
Query	
Bodies to be split.

sketchPlanes
array	
Planes that splits the bodies. Everything on the positive z side of the planes will be removed.

multiplePlanesSectionTransformedParts (context is Context, id is Id, definition is map)

method for processing all part studio parts for assembly for multiple planes section

Parameter	Type	Additional Info
definition	map	
targets
array	
Bodies to be split.

planes
array	
Planes that splits the bodies. Everything on the positive z side of the planes will be removed.

jogSectionPart (context is Context, id is Id, definition is map)

Split a part down a jogged section line and delete all back bodies. Used by drawings. Needs to be a feature so that drawings created by queries can resolve. Any bodies not included in the target query are deleted.

Parameter	Type	Additional Info
definition	map	
target
Query	
Bodies to be split.

sketchPlane
Plane	
Plane that the jog line will be drawn in and extruded normal to. Everything on the positive x side of the jog line will be removed.

jogPoints
array	
Points that the cutting line goes through in world coordinates.

isPartialSection
boolean	
Whether or not it is a partial section cut.

keepSketches
boolean	
Whether or not sketches will be kept in the section cut results.

isBrokenOut
boolean	
Whether or not it is a broken-out section cut.

isCropView
boolean	
Whether or not it is a crop section cut.

brokenOutPointNumbers
array	
Array of the number of spline points of each broken-out section cut.

brokenOutEndConditions
array	
Array of end conditions of each broken-out section cut.

offsetPoints
array	
Array of points for offsetting the section lines.

isAlignedSection
boolean	
Whether or not it is an aligned section cut.

sidegeometryrule
SideGeometryRule enum

See opThicken.

Value	Description
REVOLVED	
SUPPLIED	
smcornertype
SMCornerType enum

Specifies the type of corner at a vertex of a sheet metal model.

Value	Description
OPEN_CORNER	
The corner has more than two bends or, when folded the edges of the metal do not meet.

CLOSED_CORNER	
The corner has two bends and when folded the edge of the metal meet.

BEND_END	
The 'corner' is the end of a bend and there may be bend relief.

NOT_A_CORNER	
The vertex is not associated with a corner

splitoperationkeeptype
SplitOperationKeepType enum

See opSplitPart.

Value	Description
KEEP_ALL	
KEEP_FRONT	
KEEP_BACK	
surfacetype
SurfaceType enum

The subset of GeometryType which applies to 2-dimensional entities

Value	Description
PLANE	
CYLINDER	
CONE	
SPHERE	
TORUS	
OTHER	
REVOLVED	
EXTRUDED	
MESH	
SPLINE	
sweeptwisttype
SweepTwistType enum

Specifies twist type for sweep.

Value	Description
TURNS	
ANGLE	
PITCH	
tabletextalignment
TableTextAlignment enum

How text in a table column should be aligned

Value	Description
LEFT	
CENTER	
RIGHT	
tessellatedloftreturnstatus
TessellatedLoftReturnStatus enum

Enumerates failure modes for tessellated loft.

Value	Description
OK	
No error.

CRISS_CROSSED_MATCHES	
At least two matches cross each other.

UNDERNOURISHED_MATCHES	
At least one match consists of fewer than 2 match points.

NON_CONSECUTIVE_MATCHES	
A match jumps across a profile without specifying a match point.

MATCHING_CYLINDER_CREATION_FAILED	
Most likely due to two profiles touching.

NON_CURVE_INPUT	
Only curves are allowed within profiles.

UNIDENTIFIED	
Some unknown error occurred.

INVALID_MATCH_POINT_INDEX	
At least one of the match indices points to a non-existent match point.

INVALID_MATCH_POINT	
At least one match point is specified on non-profile topology.

toleranceschemaclass
ToleranceSchemaClass enum

Used to specify the Onshape standard schema class for a dimension, as in setDimensionedEntities.

Value	Description
FILLET_RADIUS	
CHAMFER_DISTANCE	
CHAMFER_ANGLE	
tool
The tool.fs module contains enum types shared by multiple features.

MoveFaceType enum

Defines how face should be transformed in a moveFace feature.

Also used by boolean.

Value	Description
OFFSET	
TRANSLATE	
ROTATE	
ToolBodyType enum

Defines what type of body a body-creating feature (extrude, revolve, etc.) should create.

Value	Description
SOLID	
SURFACE	
ExtendedToolBodyType enum

Defines what type of body a body-creating feature (extrude, revolve, etc.) should create.

Value	Description
SOLID	
SURFACE	
THIN	
NewBodyOperationType enum

Defines how a new body from a body-creating feature (extrude, revolve, etc.) should be merged with other bodies in the context.

To include this enum with the same styling as the extrude dialog (and others), use booleanStepTypePredicate(definition).

Value	Description
NEW	
Creates a new body in the context with the geometry resulting from the operation.

ADD	
Performs a boolean union between the new body and all bodies in the merge scope.

REMOVE	
Performs a boolean subtraction of the new body from all bodies in the merge scope.

INTERSECT	
Performs a boolean intersection between each new body and each body in the merge scope.

NewSurfaceOperationType enum

Defines how a new surface from a surface-creating feature (sweep, loft, revolve, etc.) should be merged with other surfaces in the context.

To include this enum with the same styling as the extrude dialog (and others), use booleanStepTypePredicate(definition).

Value	Description
NEW	
Creates a new surface in the context with the geometry resulting from the operation.

ADD	
Performs a surface union between the new surface and all surfaces used as input.

uihint
UIHint enum

List of available UI Hints, which control how a parameter input is displayed in the feature dialog.

EXAMPLE

annotation { "Name" : "Flip", "UIHint" : UIHint.OPPOSITE_DIRECTION }
definition.isFlipped is boolean;
Multiple UIHints can be specified in an array (e.g. [ UIHint.OPPOSITE_DIRECTION, UIHint.REMEMBER_PREVIOUS_VALUE ]).

Raw strings (e.g. "OPPOSITE_DIRECTION") may be used in place of the enum access (e.g. UIHint.OPPOSITE_DIRECTION) for the same result.

OPPOSITE_DIRECTION and ALWAYS_HIDDEN behaviors are considered stable. Other UIHints can be used, but their behaviors may change in future versions of Onshape.

Value	Description
OPPOSITE_DIRECTION	
For a boolean parameter, display as a toggle button with arrow next to the previous parameter.

ALWAYS_HIDDEN	
Do not display this parameter or allow a user to edit it (useful for parameters changed only in editing logic or manipulator change functions).

SHOW_CREATE_SELECTION	
For a query parameter, include a button to open the "Create selection" dialog.

CONTROL_VISIBILITY	
For Onshape internal use.

NO_PREVIEW_PROVIDED	
For a feature, hide the preview slider which controls before/after transparency, and only show the final version.

REMEMBER_PREVIOUS_VALUE	
When a user makes a new instance of this feature, set this parameter's default value to the value they set the last time they used this feature.

DISPLAY_SHORT	
Two consecutive boolean or quantity parameters marked as DISPLAY_SHORT may be placed on the same line.

ALLOW_FEATURE_SELECTION	
For Onshape internal use.

MATE_CONNECTOR_AXIS_TYPE	
For Onshape internal use.

PRIMARY_AXIS	
For Onshape internal use.

SHOW_EXPRESSION	
If an expression (like #foo or 1/4 in) is entered, always show the expression, and never the resulting value.

OPPOSITE_DIRECTION_CIRCULAR	
Like OPPOSITE_DIRECTION, but with circular arrows.

SHOW_LABEL	
Show a label above an enum parameter.

HORIZONTAL_ENUM	
Display an enum as a horizontal list of clickable text, rather than the default select control

UNCONFIGURABLE	
For Onshape internal use.

MATCH_LAST_ARRAY_ITEM	
Inside an array parameter, set the default value on a new item to match what is set on the last item.

COLLAPSE_ARRAY_ITEMS	
For an array parameter, create new items (and items in a newly opened dialog) as collapsed by default.

INITIAL_FOCUS_ON_EDIT	
When an existing feature is edited, the first visible parameter with this UI hint will get focus.

INITIAL_FOCUS	
When creating or editing, the first visible parameter with this UI hint will get focus (but when editing, a parameter with INITIAL_FOCUS_ON_EDIT takes precedence).

DISPLAY_CURRENT_VALUE_ONLY	
For Onshape internal use.

READ_ONLY	
Prevent changes to the parameter from the feature dialog. A read-only parameter can be modified by the editing logic function.

PREVENT_CREATING_NEW_MATE_CONNECTORS	
For a query parameter allowing BodyType.MATE_CONNECTOR, only allow preexisting mate connectors, and don't provide a button to allow creating new mate connectors specificaly for this parameter.

FIRST_IN_ROW	
Guarantee that, regardless of other layout requirements, this parameter will always be the first parameter in its displayed row.

ALLOW_QUERY_ORDER	
Enable reordering of queries in a query parameter.

PREVENT_ARRAY_REORDER	
Disable reordering of items in an array parameter.

FOCUS_INNER_QUERY	
When adding a new item to an array parameter, focus the driving inner QLV if the parameter is selection-driven, and focus the first inner QLV otherwise.

SHOW_TOLERANCE	
For a boolean parameter, display as a toggle button with tolerance icon next to the previous parameter.

ALLOW_ARRAY_FOCUS	
Allow focusing an array parameter with no driving or inner QLV, as if it were selection-driven.

SHOW_INLINE_CONFIG_INPUTS	
Inline the configuration parameters in the configure dialog for the feature.

FOCUS_ON_VISIBLE	
For a query parameter, selects it when it becomes visible during editing.

CAN_BE_TOLERANT	
For a quantity parameter, specifies that the quantity can be tolerant.

CAN_BE_TOLERANT_DIAMETER	
For a quantity parameter that represents a diameter, specifies that the quantity can be tolerant and should display options to specify hole or shaft fit classes.

PLUS_MINUS	
Like OPPOSITE_DIRECTION but indicating whether the associated quantity is positive or negative.

ALWAYS_USE_DEPENDENCIES	
Always use the content of this parameter to determine feature dependencies.

NO_QUERY_VARIABLE	
Hides the query variable dropdown for the associated query parameter.

ALLOW_FLAT_SKETCH_SELECTION	
Allows a feature list parameter to select sketches defined on flat views.

variabletype
VariableType enum

See assignVariable.

Value	Description
LENGTH	
ANGLE	
NUMBER	
ANY	
volumeaccuracy
VolumeAccuracy enum

Level of accuracy to use for computing the volume of a solid body. The values are:

LOW: fastest, least accurate, good for approximations
MEDIUM: moderately fast, moderately accurate
HIGH: slowest, most accurate, required for regeneration
Value	Description
LOW	
MEDIUM	
HIGH	
weldfinishing
WeldFinishing enum

Enum to determine the weld finishing in ANSI standard.

Value	Description
NONE	
CHIPPING	
GRINDING	
HAMMERING	
MACHINING	
ROLLING	
UNSPECIFIED	
weldstandard
WeldStandard enum

Enum to switch the weld symbol representation between ANSI and ISO standard.

Value	Description
ANSI	
ISO	
wraptype
WrapType enum

Specifies the type of wrap to execute.

Value	Description
SIMPLE	
Wrap around the infinite definition of the destination surface.

TRIM	
Wrap around a defined destination face, and trim anything that falls off of it.

