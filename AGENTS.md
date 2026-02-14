# Project Agents.md Guide for OpenAI Codex

This Agents.md file provides comprehensive guidance for OpenAI Codex and other AI agents working with this codebase.

## Project Structure for OpenAI Codex Navigation

The repository follows a consistent layout across frontend and backend. Instead of enumerating every directory, the standardized structure patterns are described below:

- `/frontend/src`: Source code for the client-side application

  - `/components`: Reusable UI fragments. Each component resides in its own folder, containing:

    - `component.html` (markup)
    - `css/` directory for stylesheet files corresponding to that component (e.g., `component.css`)

  - `/css`: Global CSS modules and utilities (e.g., `base.css`, `normalize.css`, `typography.css`, `utilities.css`). These styles apply site-wide.
  - `/assets/images`: Static image assets organized into subfolders (e.g., `animals/`, `hero/`, `icons/`, `logos/`).
  - `/pages`: Individual pages are grouped by feature, each in its own subfolder. Each page folder follows this pattern:

    - `pageName.html` (HTML entrypoint for that page)
    - `pageName.js` (JavaScript logic specific to that page)
    - `css/` folder containing `pageName.css` for styling that page
    - `scripts/` folder containing page-specific utility scripts (e.g., `carousel.js`, `search.js`)

  - `/scripts`: Shared client-side utilities loaded on multiple pages (e.g., `loadHeaderFooter.js`, `checkAuth.js`, `dropDownMenu.js`, `tabs.js`). These are injected into relevant pages via dependencies in HTML templates.
  - `main.js`: Top-level JavaScript to bootstrap global behaviors (e.g., header initialization, mobile menu toggles).
  - `styles.css`: Entrypoint stylesheet that imports or references global styles and utilities.

- `/backend/src`: Source code for the server-side application (Express, GraphQL, Sequelize/Mongoose)

  - `/config`: Configuration files for database, ORM, Redis, environment variables (e.g., `database.js`, `mongoose.js`, `redis.js`).
  - `/models`: Data models representing entities (e.g., `reptile.js`, `user.js`, `adoption.js`, `paperwork.js`). Each model exports a schema/definition for ORM usage.
  - `/routes`: Express route handlers that map HTTP endpoints to resolver logic (e.g., `reptiles.js`, `adoptions.js`, `auth.js`).
  - `/resolvers`: Resolver functions for GraphQL queries and mutations, organized under index files.
  - `/schemas`: GraphQL schema definitions (type definitions, input types, etc.).
  - `server.js`: Main server bootstrap file that initializes Express, middleware (CORS, sessions), GraphQL server, and starts listening.

- `/docs`: Documentation divided into frontendDocs and backendDocs

  - `/docs/frontendDocs`: Guides for frontend conventions (e.g., `WEBPACK_CONFIG_GUIDE.md`, formatting requirements, commenting guidelines).
  - `/docs/backendDocs`: Guides for backend setup (e.g., `REPTILE_BACKEND_SETUP.md`, database migration instructions, PostgreSQL guide).

- `/tests`: Placeholder directory for test suites. Currently contains `README.md`. When tests exist, they follow:

  - `*.test.js` or `*.spec.js` naming convention under feature-specific subfolders.

- Configuration files at the root:

  - `package.json`: Scripts and dependencies for orchestrating frontend and backend tasks via npm
  - `.prettierrc` and `eslint.config.mjs`: Formatting and linting rules
  - Husky pre-commit hooks under `.husky/`, lint workflows under `.github/workflows/lint.yml`

## Coding Conventions for OpenAI Codex

### General Conventions for Agents.md Implementation

- All new code should follow existing JavaScript style (ES6 modules). Do not introduce TypeScript or frameworks not currently used.
- Use descriptive variable and function names consistent with existing naming patterns (camelCase for functions/variables, PascalCase for constructor-like classes).
- Add JSDoc-style comments for any nontrivial logic (e.g., complex data transformations, asynchronous flows).
- Ensure new files adhere to Prettier formatting and ESLint rules (run `npm run lint` and `npm run format`).
- Follow the repository’s folder and file naming patterns (e.g., page folders named in kebab-case, components named in lowercase).

### Frontend Guidelines for OpenAI Codex

- Continue using vanilla JavaScript (ES6) and plain CSS. Do not switch to React, Vue, or TypeScript.
- When creating or updating components:

  - Place each component under `/frontend/src/components/<componentName>/`
  - Include a single HTML file for markup (`<componentName>.html`) and a CSS folder (`css/<componentName>.css`) for that component’s styles.
  - If component-level scripts are needed, place them under `scripts/` but only if unique to that component. Otherwise, use shared utilities.

- When adding or updating page code:

  - Create or modify under `/frontend/src/pages/<pageName>/`
  - Follow the four-file convention:

    - `<pageName>.html` (the HTML template)
    - `<pageName>.js` (page-specific JS logic)
    - `css/<pageName>.css` (page-specific styling)
    - `scripts/<utility>.js` (page-level helper scripts, if needed)

  - Ensure that any new scripts required by the page are referenced in `<pageName>.html` using `<script>` tags at the bottom of the body.

- Use global utilities (e.g., `loadHeaderFooter.js`) to inject shared elements (header, footer, menus) rather than duplicating markup.
- CSS:

  - Use utility classes defined in `/frontend/src/css/utilities.css` when possible (e.g., spacing, typography).
  - Organize custom page or component styles under their respective `css/` directories.
  - Avoid inline CSS `style` attributes; always place styles in `.css` files.

### Backend Guidelines for OpenAI Codex

- Follow existing patterns in `/backend/src`:

  - Configuration files under `/backend/src/config/` should export necessary connection objects (e.g., `module.exports = mongooseConnection`).
  - Models in `/backend/src/models/` define and export schemas. New models must follow the existing structure (e.g., import `Sequelize` or `mongoose`, define attributes, export via `module.exports`).
  - Express routes in `/backend/src/routes/` should:

    - Import controllers or resolver functions.
    - Use router-level middleware (`express.Router()`).
    - Export the router, which is then mounted in `server.js`.

  - GraphQL resolvers under `/backend/src/resolvers/index.js` should match type definitions in `/backend/src/schemas/`. When adding new resolvers, ensure arguments and return values conform to schema.

- Use async/await for asynchronous operations. Wrap top-level `await` calls in `try/catch` blocks and pass errors to Express `next(err)`.
- Follow existing naming conventions: Model names are singular (e.g., `Reptile`), route files are plural (e.g., `reptiles.js`).
- Do not introduce new dependencies without updating `backend/package.json` and verifying with `npm install` and `npm run lint`.

## Testing Requirements for OpenAI Codex

Currently, no test files exist. When tests are introduced, they should follow these guidelines:

- Place tests under `/tests/<feature>/` with filenames: `<feature>.test.js` (or `.spec.js`).
- Use Jest or Mocha (depending on project direction) and follow a BDD style (`describe`, `it`).
- Run all tests with:

  ```bash
  npm test
  ```

- Run a specific test file with:

  ```bash
  npm test -- tests/<feature>/<feature>.test.js
  ```

- Collect coverage with:

  ```bash
  npm test -- --coverage
  ```

## Pull Request Guidelines for OpenAI Codex

When assisting with or generating a pull request, ensure:

1. **Clear Description**: PR title and description should succinctly explain the change (e.g., "Add form validation to adoptionForm").
2. **Issue Reference**: Link any related GitHub issue (e.g., `Refs #42`).
3. **Lint and Formatting**: All new or modified `.js` and `.css` files pass:

   ```bash
   npm run lint
   npm run format
   ```

4. **Focus on Single Concern**: Keep PRs small and targeted (e.g., "Refactor header component" vs. "Add new features + refactor everything").
5. **Screenshots/Examples**: For frontend changes, include before-and-after screenshots and note which pages/components are affected.
6. **Documentation**: Update relevant docs under `/docs/frontendDocs` or `/docs/backendDocs` if behavior changes.

## Programmatic Checks for OpenAI Codex

Before merging or finalizing any AI-generated changes, run:

```bash
# Lint check for project-wide JavaScript
npm run lint

# Format check for CSS/JS
npm run format

# Verify frontend build for syntax errors
npm run build:frontend

# Verify backend starts without errors
npm run start:backend
```

All checks must pass before OpenAI Codex generated code can be merged. Agents.md helps ensure OpenAI Codex follows these requirements.
