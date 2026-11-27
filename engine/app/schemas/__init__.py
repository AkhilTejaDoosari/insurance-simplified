"""Service contract (one-way door): every model here is exported to contracts/openapi.json.

Changing a model is a contract change: regenerate the OpenAPI file and the web
types in the same commit (CI fails otherwise).
"""

CONTRACT_VERSION = "2.0.0-alpha.1"
