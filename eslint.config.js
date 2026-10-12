import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const nativeTitle = {
  meta: {
    type: "problem",
    schema: [],
    messages: { forbidden: "Use visible text, aria-label, or aria-description instead of a native title tooltip." },
  },
  create(context) {
    const controls = new Set();
    const namespaces = new Set();
    const tagIsControl = (tag) => tag.type === "JSXIdentifier"
      ? /^[a-z]/.test(tag.name) || controls.has(tag.name)
      : tag.type === "JSXMemberExpression" && (tagIsControl(tag.object) || namespaces.has(tag.object.name));
    const isUiModule = (source) => source === "@base-ui/react" || source.startsWith("@base-ui/react/") || source === "lucide-react" || source === "@ragents/web/ui"
      || /(?:^|\/)ui(?:\/[^/]+)?(?:\.[jt]sx?)?$/.test(source) || /(?:^|\/)Toolbar(?:\.tsx)?$/.test(source);
    const reportTitle = (node) => {
      if (node.type === "Property" && (node.key.name ?? node.key.value) === "title") context.report({ node, messageId: "forbidden" });
      else if (node.type === "ObjectExpression") node.properties.forEach(reportTitle);
      else if (node.type === "ConditionalExpression") { reportTitle(node.consequent); reportTitle(node.alternate); }
      else if (node.type === "LogicalExpression") { reportTitle(node.left); reportTitle(node.right); }
    };
    return {
      ImportDeclaration(node) {
        if (!isUiModule(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name);
          else if (specifier.type !== "ImportSpecifier" || !["BrandLogo", "SectionHeading"].includes(specifier.imported.name)) controls.add(specifier.local.name);
        }
      },
      JSXAttribute(node) {
        if (node.name.name === "title" && tagIsControl(node.parent.name)) context.report({ node, messageId: "forbidden" });
      },
      JSXSpreadAttribute(node) {
        if (tagIsControl(node.parent.name)) reportTitle(node.argument);
      },
    };
  },
};

export default tseslint.config(
  tseslint.configs.recommended,
  {
    files: ["apps/web/src/**/*.{ts,tsx}", "plugins/*/web/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}", "plugins/*/web/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/ui/tooltip.tsx"],
    plugins: { "ragents-ui": { rules: { "no-native-title": nativeTitle } } },
    rules: { "ragents-ui/no-native-title": "error" },
  },
);
