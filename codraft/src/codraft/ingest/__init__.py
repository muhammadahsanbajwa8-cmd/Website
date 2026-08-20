"""Reading drawings that already exist.

Everything else in codraft goes one way: a brief becomes a model becomes a
drawing. This package goes the other way -- it takes a drawing somebody
else made and tries to recover enough of a model to check it.

How much it recovers depends entirely on what it is given, and the package
is built to say which:

    IFC       a building model already; read it and you have the model
    DXF       real geometry with layers; walls are recoverable
    PDF       geometry with no meaning attached; walls must be inferred
    a scan    pixels; only the printed numbers are recoverable

The rule that governs all of it: **transcribe, never estimate**. A
dimension printed on a drawing is a fact and can be read. A distance
measured off an image is a guess, and a guess with a millimetre value
attached is worse than no answer, because it looks like a fact.
"""

from .pdfread import PdfDocument, PdfError, Segment, TextRun, read_pdf

__all__ = ["PdfDocument", "PdfError", "Segment", "TextRun", "read_pdf"]
