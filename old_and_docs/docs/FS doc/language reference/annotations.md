Annotations
Top level declarations, enumeration values, and statements may have annotations. An annotation is a set of key+value pairs written as a map literal. Annotations are interpreted by system software and are not visible to programs.

Annotation keys should be strings.

Annotation values are usually strings or enumerations, but other valid expressions may be used. However, these expressions do not have access to function local variables even if they appear inside a function. The system may ignore erroneous values.

Annotations are used to define the user interface for features. For example, consider the definition

export enum BooleanOperationType
{
    annotation {"Name" : "Union"}
    UNION,
    annotation {"Name" : "Subtract"}
    SUBTRACTION,
    annotation {"Name" : "Intersect"}
    INTERSECTION,
    annotation {"Hidden" : true}
    SUBTRACT_COMPLEMENT
}
The annotations take effect when BooleanOperationType is used as a feature parameter. Then the names appear in the feature menu except for the hidden value which is not available to users. (In this case the hidden value is meant for use in FeatureScript code.)

A feature has an annotation like

annotation { "Feature Type Name" : "Fillet" }
The "Feature Type Name" is required on all features.