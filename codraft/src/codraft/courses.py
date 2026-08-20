"""Brick courses, because that is the unit a Western Australian house is set out in.

Nothing vertical on a Perth permit set is given in millimetres first. Ceiling
levels are "28c", a window head is "25c", a sill is "10c", and the elevation
carries "CL 2435 (28c + PLATE)" -- the millimetre figure is the derived one.
A bricklayer builds to courses, so a ceiling specified at 2400 mm gets built
at 28 courses and ends up at 2435, and a tool that hands back 2400 is asking
for a dimension nobody will lay.

The numbers here are read off a real set: Redink Homes' "The Trio", where
28c is called up as 2435 and 31c as 2692. Both work out at 86 mm of
brickwork per course plus about 26 mm of top plate, which is the standard
76 mm brick and 10 mm bed joint.
"""

from __future__ import annotations

# 76 mm brick plus a 10 mm bed joint. Standard across Australia.
COURSE_MM = 86

# The wall plate sitting on the top course, before the ceiling lining.
PLATE_MM = 26

# What project homes actually build to. 28c is the standard ceiling and 31c
# the raised one used over living areas -- both clear the NCC's 2400 mm,
# which 27c would not.
STANDARD_CEILING_COURSES = 28
RAISED_CEILING_COURSES = 31


def ceiling_height(courses: int, plate: int = PLATE_MM) -> int:
    """Finished ceiling level for a number of courses, in millimetres."""
    return courses * COURSE_MM + plate


def courses_for(height_mm: int, plate: int = PLATE_MM) -> int:
    """How many courses are needed to reach at least this height.

    Rounded UP, always. A ceiling specified at 2400 mm is built at 28
    courses and finishes at 2435; rounding down would build it at 27 and
    finish at 2348, which fails the NCC by 52 mm -- a code failure created
    by arithmetic rather than by design.
    """
    if height_mm <= plate:
        return 0
    return -(-(height_mm - plate) // COURSE_MM)


def snap_to_course(height_mm: int, plate: int = PLATE_MM) -> int:
    """Round a height up to the next whole course."""
    return ceiling_height(courses_for(height_mm, plate), plate)


def storey_height_for(ceiling_courses: int, floor_structure_mm: int = 200) -> int:
    """Floor to floor, given the ceiling in courses and the floor build-up."""
    return ceiling_height(ceiling_courses) + floor_structure_mm


def as_courses(height_mm: int) -> str:
    """A height written the way the drawing writes it: '2435 (28c)'."""
    return f"{height_mm} ({courses_for(height_mm)}c)"


def describe(height_mm: int) -> str:
    """A course height with its millimetre equivalent, for a notes block."""
    courses = courses_for(height_mm)
    exact = ceiling_height(courses)
    if exact == height_mm:
        return f"{courses}c ({height_mm} mm)"
    return f"{courses}c ({exact} mm, from {height_mm} mm requested)"
