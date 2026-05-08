Exception handling
Exceptions are used to report and possibly handle error conditions. An exception is raised when an error occurs and optionally caught if the error should not terminate the program.

An exception might be raised for many reasons, including

An invalid numeric operation like square root of a negative number
A precondition failing
A map lookup (. or [] operator) on undefined
A failing operation, evaluation, or feature
An exception is caught if it is raised while a try is active. Features and evaluation of feature parameters are inside of a try. Otherwise, the program terminates if an exception is not caught.

There are two forms of try, statement and expression.

Expression try looks like

try (0/0)
try (f(x) - f(y))
An expression is surrounded by parentheses and preceded by try. If an exception is raised while evaluating the expression, the result is undefined. The caller is responsible for handling the result. The expression

try (0/0) - 0
will raise another exception due to the invalid operation undefined - 0.

Statement try looks like

try { f(x); }
try { f(x); } catch { fail(); }
try { f(x); } catch (e) { analyze(e); }
The block statement (i.e. surrounded with braces) after try is known as a try block, and the block statement after catch is known as a catch block.

A try block is aborted as soon as an exception is raised. If there is no catch block, execution continues with the next statement after the try block. If there is a catch block, it is executed when an exception is raised inside the try block. (Inside includes inside functions called from the try block.)

Catch blocks are only executed when an exception is raised. Otherwise execution skips over them.

In the last example, the exception value is available for inspection. Exceptions are values just like any other. Language errors are usually strings and library errors are usually maps with a message field of type ErrorStringEnum.

Finally, an exception may be raised with a throw statement.

throw;
throw "an error has occurred";
throw { message : ErrorStringEnum.TOO_MANY_ENTITIES_SELECTED }
try { f(); } catch (e) { throw e; }
If more than one try statement or expression is active, the most recently entered try handles the exception. A handler may rethrow the exception, as in the last example above, and the next handler will have a chance. (A catch block does not handle exceptions thrown inside itself.)

Any raised exception is reported in the notices flyout whether or not it is caught. To suppress this reporting for exceptions that are expected to happen, try silent may be used in either the statement or the expression form as follows:

var x = try silent (myMap.submapThatMayNotExist.subMapKey);
try silent { plane = evPlane(context, { face : mightBePlane }); }
A try silent suppresses reporting of all exceptions inside it and therefore has the potential of making code difficult to debug; it should be used with caution and around limited and well-understood code.