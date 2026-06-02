const fs = require('fs');
const path = require('path');

function formatTimestamp(date) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ];

  return parts.join('');
}

function normalizeName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const rawName = process.argv[2];

if (!rawName) {
  console.error('Usage: npm run make:migration -- <description>');
  process.exit(1);
}

const normalizedName = normalizeName(rawName);

if (!normalizedName) {
  console.error('Migration description must contain letters or numbers.');
  process.exit(1);
}

const timestamp = formatTimestamp(new Date());
const fileName = `V${timestamp}__${normalizedName}.sql`;
const targetDir = path.join(__dirname, '..', 'db', 'migrations', 'versioned');
const targetPath = path.join(targetDir, fileName);

fs.mkdirSync(targetDir, { recursive: true });

if (fs.existsSync(targetPath)) {
  console.error(`Migration already exists: ${fileName}`);
  process.exit(1);
}

fs.writeFileSync(targetPath, '', 'utf8');

console.log(`Created ${path.relative(process.cwd(), targetPath)}`);
