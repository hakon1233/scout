# Research runs on the reader's machine, through their own Claude Code CLI

Scout has no backend and no API key. A small companion on the reader's machine stores
their interests and briefs. It runs each research session by starting the reader's
`claude` CLI, which signs in by itself and uses only its built-in WebSearch and WebFetch.
The alternative was a hosted server that holds an Anthropic key and a search-API key.
That costs money for every brief and puts the keys, plus every reader's interests and
articles, on a server we run. The price of the companion is setup: the reader installs
and runs a process. It also moves the trust boundary to a loopback port. So the companion
checks the Host header, allows only listed origins, needs a pairing token on every data
route, and starts `claude` with a fixed, minimal tool list (see `SECURITY.md`).
