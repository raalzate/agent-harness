#!/usr/bin/env bash
# Envoltorio. La implementación del gate es `scripts/gate.mjs`, en Node.
#
# Por qué: el arnés tiene que correr también en Windows, donde bash no está garantizado — y un
# gate que no corre es un gate que no existe. Este archivo queda para no romper a quien ya
# escribió `bash scripts/gate.sh` en su CI, en su config o en su memoria muscular. Hay UNA
# implementación: si algo se cambia, se cambia allá.
exec node "$(dirname "$0")/gate.mjs" "$@"
