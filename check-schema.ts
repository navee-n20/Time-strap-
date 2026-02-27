import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pmsPool = new Pool({
    connectionString: process.env.PMS_DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function checkSchema() {
    try {
        console.log(`Checking columns for key_steps table...`);
        const result = await pmsPool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'key_steps'
    `);

        console.log('Columns in key_steps:');
        result.rows.forEach(row => console.log(`- ${row.column_name} (${row.data_type})`));

        if (result.rows.length === 0) {
            console.log('Table "key_steps" not found or no columns.');
        }

    } catch (error) {
        console.error('Error checking schema:', error);
    } finally {
        await pmsPool.end();
    }
}

checkSchema();
