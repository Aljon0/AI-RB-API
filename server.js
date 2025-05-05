// server.js
import { Mistral } from '@mistralai/mistralai';
import cors from "cors";
import dotenv from "dotenv";
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Initialize Express application
const app = express();
const PORT = process.env.PORT || 5000;

// Set up directory for file storage
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Middleware
app.use(cors({ 
  origin: ['http://localhost:5173', 'http://localhost:3000','https://ai-rb-haee.onrender.com/'] // Allow both Vite dev server and potential React dev server
}));
app.use(express.json({ limit: '50mb' }));

// Rate limiting variables
const requestQueue = [];
let isProcessing = false;
const MIN_REQUEST_INTERVAL = 1000; // 1 second between requests
let lastRequestTime = 0;

// Function to process the queue
async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  
  isProcessing = true;
  const currentTime = Date.now();
  const timeToWait = Math.max(0, MIN_REQUEST_INTERVAL - (currentTime - lastRequestTime));
  
  // Wait if needed to respect rate limits
  if (timeToWait > 0) {
    await new Promise(resolve => setTimeout(resolve, timeToWait));
  }
  
  const { jobTitle, res, retryCount = 0 } = requestQueue.shift();
  lastRequestTime = Date.now();
  
  try {
    const skills = await fetchSkillsFromMistral(jobTitle, retryCount);
    res.status(200).json({ skills });
  } catch (error) {
    console.error("Error in queue processing:", error);
    res.status(500).json({ 
      error: 'Failed to get suggestions',
      skills: getDefaultSkills(jobTitle)
    });
  }
  
  isProcessing = false;
  processQueue(); // Process next item in queue
}

// Function to fetch skills from Mistral with retry logic
async function fetchSkillsFromMistral(jobTitle, retryCount) {
  try {
    // Initialize Mistral AI client
    const client = new Mistral(process.env.MISTRAL_API_KEY);
    
    // Create the prompt for Mistral AI
    const prompt = `Generate a list of 8-12 relevant professional skills for someone with the job title "${jobTitle}". 
    Include both technical and soft skills that would be valuable for this role. 
    Format the response as a JSON array of strings containing only the skill names.
    For example: ["JavaScript", "React", "Problem Solving"]`;

    // Call Mistral AI API
    const response = await client.chat.complete({
      model: "mistral-large-latest", // Use appropriate model
      messages: [
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    let skills = [];
    
    try {
      // Try to parse JSON from the response
      const content = response.choices[0].message.content;
      // Extract JSON array if it's embedded in text
      const jsonMatch = content.match(/\[.*\]/s);
      
      if (jsonMatch) {
        skills = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback if response isn't valid JSON
        skills = content
          .split(',')
          .map(skill => skill.trim())
          .filter(skill => skill.length > 0);
      }
    } catch (parseError) {
      console.error("Error parsing Mistral AI response:", parseError);
      skills = getDefaultSkills(jobTitle);
    }

    // Ensure we have at least some skills
    if (!skills || skills.length === 0) {
      skills = getDefaultSkills(jobTitle);
    }

    return skills;
    
  } catch (error) {
    // Handle rate limiting errors with exponential backoff
    if (error.message && error.message.includes("rate limit") && retryCount < 3) {
      const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff
      console.log(`Rate limit hit, retrying in ${retryDelay}ms (attempt ${retryCount + 1})`);
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      
      // Add back to queue with increased retry count
      requestQueue.push({ jobTitle, res, retryCount: retryCount + 1 });
      processQueue();
      return null; // Will be handled by queue processor
    }
    
    console.error("API error:", error);
    return getDefaultSkills(jobTitle);
  }
}

// Mistral AI endpoint
app.post('/api/get-skills-suggestions', async (req, res) => {
  try {
    const { jobTitle } = req.body;
    
    if (!jobTitle || jobTitle.trim() === '') {
      return res.status(400).json({ 
        error: 'Job title is required',
        skills: ["Communication", "Problem Solving", "Teamwork", "Time Management"]
      });
    }

    // Add request to queue instead of processing immediately
    requestQueue.push({ jobTitle, res });
    processQueue();
    
  } catch (error) {
    console.error("Request handling error:", error);
    return res.status(500).json({ 
      error: 'Failed to process request',
      skills: getDefaultSkills(req.body.jobTitle)
    });
  }
});

// Fallback function for default skills
function getDefaultSkills(jobTitle = "") {
  const commonSkills = [
    "Communication",
    "Problem Solving",
    "Teamwork",
    "Time Management",
  ];

  const lowerTitle = jobTitle.toLowerCase();
  if (lowerTitle.includes("nurse") || lowerTitle.includes("nursing")) {
    return [
      "Patient Care", 
      "Medical Record Documentation",
      "Vital Signs Monitoring",
      "Medication Administration",
      "Wound Care",
      "Patient Advocacy",
      "CPR/BLS Certified",
      "Care Planning",
      "Clinical Assessment",
      "EMR/EHR Systems",
      ...commonSkills.slice(0, 2)
    ];
  }
  if (lowerTitle.includes("developer") || lowerTitle.includes("engineer")) {
    return [...commonSkills, "JavaScript", "React", "Git", "CSS", "HTML"];
  }
  if (lowerTitle.includes("designer")) {
    return [...commonSkills, "UI/UX", "Figma", "Adobe Creative Suite", "Prototyping"];
  }
  if (lowerTitle.includes("manager")) {
    return [...commonSkills, "Leadership", "Project Management", "Agile", "Budgeting"];
  }
  
  return [...commonSkills, "Research", "Microsoft Office", "Organization", "Analysis"];
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Rate limiting: minimum ${MIN_REQUEST_INTERVAL}ms between Mistral API requests`);
});