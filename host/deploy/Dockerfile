# =====================================================================================
# host/deploy/Dockerfile — P22A2, the OCI image for the deploy artifact and nothing else.
#
# P22A1 fixed how a mounted credential reaches the existing audited runner without ever becoming an
# OS argument, and deliberately built no container. This file builds that container: one image that
# carries BOTH runtimes the boundary actually needs — Node, because the audited kernel boundary is
# JS, and Python, because the ASGI host that will front it is Python — plus the real P22A1 wrapper
# as its entrypoint.
#
# Four properties are load-bearing, and each is a choice against a cheaper alternative:
#
#   - Every base is pinned to a frozen MULTIARCH INDEX digest, not a tag. A tag is a mutable
#     pointer: `node:22.23.2-bookworm-slim` can be republished, and then a rebuild no longer reads
#     the inputs this package was reviewed against. An index digest also keeps amd64 and arm64
#     pulling the same frozen release rather than whatever each architecture's tag happened to
#     resolve to. That pins the INPUTS, and only the inputs. It does not make the outputs identical:
#     the amd64 and arm64 images are different artifacts, and build timestamps and file mtimes mean
#     two rebuilds are not promised the same output digest. No bit-for-bit claim is made here.
#   - Nothing is fetched unverified. There is no network download of a toolchain, no piped install
#     script, and every install reads a lock: `npm ci` refuses to resolve outside package-lock.json,
#     pip refuses any artifact whose sha256 is not in requirements-uvicorn.txt, and the host wheel is
#     built offline from host/pyproject.toml by the pinned uv build backend.
#   - The build is multi-stage. npm, uv and the build toolchains stay in the build stages and are
#     not copied forward; the runtime image receives only their outputs. That is the exact claim,
#     and it is narrower than "no package manager": the Python slim base and the venv copied onto
#     it both still carry pip, and Debian's dpkg/apt package metadata is still present. What is
#     true is that no runtime command invokes any of them — the entrypoint is the P22A1 wrapper.
#   - The runtime declares a NUMERIC non-root user and an exec-form entrypoint. Numeric, so no
#     /etc/passwd lookup inside the image decides who this runs as; exec-form, so no shell sits
#     between a supervisor's signal and the process it means to signal.
#
# What this image does NOT do is as fixed as what it does: it starts no listener, serves no HTTP,
# contacts no database, runs no migration, is pushed to no registry and is deployed nowhere. Its
# default command is exactly the two mounted secret-file paths, so the only thing a plain `docker
# run` can do is hand the existing P22A1 wrapper two file paths and let it fail closed or delegate.
# =====================================================================================

# -------------------------------------------------------------------------------------
# Stage 1 — the Node toolchain: the locked production JS dependency set, and the binary itself
#
# `npm ci` is used rather than any resolving install: it installs exactly what package-lock.json
# records and errors out if the lock and the manifest disagree, so the version that lands in the
# image is the version this repository already tested. `--omit=dev` keeps the whole test/tooling
# tree out. `--ignore-scripts` means no package's install hook gets to run arbitrary code while the
# image is being assembled.
# -------------------------------------------------------------------------------------
FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS node-toolchain

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# -------------------------------------------------------------------------------------
# Stage 2 — the Python toolchain: one hash-locked server plus the host distribution as a real wheel
#
# The two installs are deliberately separate commands. The hash-locked set is installed with
# --require-hashes, which is all-or-nothing: pip refuses the whole file if any requirement in it
# lacks a hash, so a dependency cannot quietly slip in unhashed. The host distribution is a local
# path build and could not carry a published hash, so it is built first — offline, by the pinned uv
# build backend reading host/pyproject.toml — and then installed with --no-deps --no-index, which
# reaches no index at all. Installing it as a built WHEEL rather than copying loose source is what
# makes `python_asgi` a real site-packages distribution instead of a directory that happens to be
# importable from whatever the working directory was.
# -------------------------------------------------------------------------------------
FROM python:3.12.14-slim-bookworm@sha256:0f5b26b9518d002b6173fd61daad821fa340635ebfec5bba471013f9ca114579 AS python-toolchain

COPY --from=ghcr.io/astral-sh/uv:0.11.1@sha256:fc93e9ecd7218e9ec8fba117af89348eef8fd2463c50c13347478769aaedd0ce /uv /usr/local/bin/uv

WORKDIR /build
RUN python3 -m venv /opt/runtime

COPY host/deploy/requirements-uvicorn.txt ./requirements-uvicorn.txt
RUN /opt/runtime/bin/pip install --no-cache-dir --no-input --require-hashes --requirement ./requirements-uvicorn.txt

COPY host/pyproject.toml ./host/pyproject.toml
COPY host/python_asgi ./host/python_asgi
RUN uv build --wheel --offline --out-dir ./dist ./host \
    && /opt/runtime/bin/pip install --no-cache-dir --no-input --no-deps --no-index ./dist/*.whl

# -------------------------------------------------------------------------------------
# Stage 3 — the runtime: two runtimes, one boundary, no build toolchain carried forward
#
# The runtime keeps the Python base and receives the Node binary as a file, rather than the other
# way round: the Python distribution is an installed venv that belongs to this exact interpreter,
# while Node is a single self-contained executable that only needs the C/C++ runtime libraries this
# base already carries. Neither npm nor uv nor a build toolchain is copied forward. pip is a
# separate matter and is deliberately not claimed away: it ships with the Python slim base and with
# the venv, along with Debian's package metadata. Nothing this image runs calls any of them.
#
# Only the runtime closure is copied from the context: the real src/ boundary, the existing
# host/js_asgi runner, and the existing P22A1 wrapper — which this package does not modify. Nothing
# else in the repository is even inside the build context; host/deploy/Dockerfile.dockerignore
# denies the whole context first and then re-includes these top-level paths by name, each named
# path admitting everything beneath it.
# -------------------------------------------------------------------------------------
FROM python:3.12.14-slim-bookworm@sha256:0f5b26b9518d002b6173fd61daad821fa340635ebfec5bba471013f9ca114579 AS runtime

COPY --from=node-toolchain /usr/local/bin/node /usr/local/bin/node
COPY --from=node-toolchain /build/node_modules /app/node_modules
COPY --from=python-toolchain /opt/runtime /opt/runtime

# The venv comes first on PATH so `python3` is the interpreter that actually owns uvicorn and the
# installed host wheel, not the bare base interpreter beside it.
ENV PATH="/opt/runtime/bin:${PATH}"

COPY src /app/src
COPY host/js_asgi /app/host/js_asgi
COPY host/deploy/secret_file_runner.mjs /app/host/deploy/secret_file_runner.mjs

WORKDIR /app

# A numeric uid:gid with no matching /etc/passwd entry on purpose: there is nothing inside the image
# to edit in order to become somebody else, and the runtime cannot silently fall back to root.
USER 10001:10001

# Exec form, and the entrypoint is the EXISTING P22A1 wrapper. The default command is the fixed pair
# of mounted secret-file paths and nothing else — no inline credential is an accepted argument
# shape for this image, and no environment variable is read for one.
ENTRYPOINT ["node", "/app/host/deploy/secret_file_runner.mjs"]
CMD ["--config-file", "/run/secrets/config.json", "--database-url-file", "/run/secrets/database-url.txt"]
