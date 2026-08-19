"""codraft — floor plans from a brief, checked against building codes.

The package is deliberately split so that no layer can quietly do another
layer's job:

    program/  a brief becomes a structured list of spaces to provide
    layout/   that list becomes exact geometry, by arithmetic not by guesswork
    codes/    that geometry is checked against rules that cite their source
    export/   the result is written as DXF, IFC and SVG

Language models belong in `program` only. Dimensions are decided by the
solver, and compliance is decided by encoded rules; neither asks a model
what a corridor should measure.
"""

__version__ = "0.1.0"
