// @ts-nocheck
"use strict"

const finder = require("find-package-json")

Object.defineProperty(exports, "__esModule", {
  value: true
});

exports.default = function (babel) {
  const { types: t } = babel;
  function isRequire(node) {
    return t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name == "require"
  }
  function isImportPkginfo(node) {
    return t.isStringLiteral(node.arguments[0]) && node.arguments[0].value === "pkginfo"
  }
  function literal(value) {
    if (typeof value === "string") {
      return t.stringLiteral(value)
    } else if (typeof value === "number") {
      return t.numberLiteral(value)
    }
    throw new Error("Unexpeted type: " + (typeof value))
  }
  return {
    visitor: {
      VariableDeclaration(path, state) {
        path.traverse({
          VariableDeclarator: (declPath) => {
            if (t.isCallExpression(declPath.node.init) == false) return;
            const init = declPath.node.init;
            const firstArg = init.arguments[0]
            if (t.isIdentifier(firstArg) == false && firstArg != "module") return;
            if (isRequire(init.callee) == false) return;
            if (isImportPkginfo(init.callee) == false) return;
            const refs = init.arguments.slice(1).map(id => id.value);
            const f = finder(state.file.opts.filenameRelative)
            const v = f.next().value
            refs.forEach(d => path.insertBefore(
              t.expressionStatement(
                t.assignmentExpression("=", t.identifier(`module.exports.${d}`), literal(v[d]))
              )
            ))
            declPath.remove()
          }
        });
      }
    }
  };
}
