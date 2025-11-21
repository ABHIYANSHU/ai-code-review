import express from 'express';

const app = express();

// ✅ FIX 1: Replaced hardcoded password with Environment Variable
// This prevents secrets from being exposed in Git history.
const DB_PASSWORD = process.env.DB_PASSWORD; 

app.get('/login', (req, res) => {
    const user = req.query.user;
    
    // ✅ FIX 2: Removed dangerous 'eval()' function.
    // Used standard logging with Template Literals.
    // This prevents Remote Code Execution (RCE) attacks.
    console.log(`User logged in: ${user}`);

    res.send("Logged in successfully");
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});