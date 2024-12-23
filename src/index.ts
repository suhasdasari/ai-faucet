// Import required dependencies
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, Address, Hash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

// Load environment variables from .env file
dotenv.config();

// Initialize OpenAI client with API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Get private key from environment variables and validate its format
const privateKey = process.env.WALLET_PRIVATE_KEY as `0x${string}`;
if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
  throw new Error('Invalid private key format. It must be a hex string starting with "0x" and 64 characters long.');
}

// Create a public client for interacting with the Sepolia testnet
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(),
});

// Create an account from the private key
const account = privateKeyToAccount(privateKey);

// Create a wallet client for sending transactions
const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http(),
});

// Function to get AI response from OpenAI
async function getAIResponse(prompt: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: prompt }],
  });

  return response.choices[0].message.content || '';
}

// Function to parse AI response into transaction details
function parseAIResponse(response: string): { to: string; amount: string; explanation: string } {
  try {
    // Attempt to parse response as JSON
    const parsed = JSON.parse(response);
    if (typeof parsed.to !== 'string' || typeof parsed.amount !== 'string' || typeof parsed.explanation !== 'string') {
      throw new Error('Invalid response structure');
    }
    return {
      to: parsed.to,
      amount: parsed.amount.replace(/\s*ETH\s*$/i, ''),
      explanation: parsed.explanation
    };
  } catch (error) {
    // If JSON parsing fails, attempt to extract information using regex
    const toMatch = response.match(/to:\s*([0-9a-fA-Fx]+)/);
    const amountMatch = response.match(/amount:\s*([\d.]+)/);
    const explanationMatch = response.match(/explanation:\s*(.+)/);
    
    if (toMatch && amountMatch && explanationMatch) {
      return {
        to: toMatch[1],
        amount: amountMatch[1],
        explanation: explanationMatch[1].trim()
      };
    }
    
    console.error('Error parsing AI response:', error);
    throw new Error('Failed to parse AI response');
  }
}

// Function to make a transaction
async function makeTransaction(to: Address, amount: string): Promise<Hash> {
  // Check account balance
  const balance = await publicClient.getBalance({ address: account.address });
  const value = parseEther(amount);
  
  // Ensure sufficient funds
  if (balance < value) {
    throw new Error(`Insufficient funds. Balance: ${formatEther(balance)} ETH, Trying to send: ${amount} ETH`);
  }

  // Send transaction
  const hash = await walletClient.sendTransaction({
    to,
    value,
  });

  return hash;
}

// Function to get transaction status
async function getTransactionStatus(hash: Hash): Promise<string> {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    return receipt.status === 'success' ? 'Success' : 'Failed';
  } catch (error) {
    if (error instanceof Error && error.message.includes('could not be found')) {
      return 'Pending';
    }
    console.error('Error getting transaction status:', error);
    return 'Unknown';
  }
}

// Main function to run the AI Ethereum agent
async function main() {
  console.log('AI Ethereum Agent');
  console.log('Enter your transaction request:');

  // Listen for user input
  process.stdin.on('data', async (data) => {
    const userInput = data.toString().trim();
    
    // Check if input includes 'send' to initiate a transaction
    if (!userInput.toLowerCase().includes('send')) {
      console.log('No transaction requested. Please specify a transaction.');
      return;
    }

    try {
      // Get AI response for transaction details
      const aiResponse = await getAIResponse(`
        You are an AI agent capable of making Ethereum transactions. The user has requested: "${userInput}"
        Provide the following information in valid JSON format:
        {
          "to": "recipient address (exact address provided by the user)",
          "amount": "amount in ETH to send (number only, without 'ETH')",
          "explanation": "brief explanation of the transaction"
        }
      `);

      // Parse AI response
      const { to, amount, explanation } = parseAIResponse(aiResponse);

      console.log(`AI Response: ${explanation}`);
      console.log(`Sending ${amount} ETH to ${to}`);

      // Make the transaction
      const hash = await makeTransaction(to as Address, amount);
      console.log(`Transaction sent. Hash: ${hash}`);
      
      // Get initial transaction status
      let status = await getTransactionStatus(hash);
      console.log(`Initial transaction status: ${status}`);

      // Poll for status updates
      const intervalId = setInterval(async () => {
        status = await getTransactionStatus(hash);
        console.log(`Updated transaction status: ${status}`);
        
        if (status !== 'Pending') {
          clearInterval(intervalId);
          console.log('Transaction completed. Enter another request:');
        }
      }, 5000); // Check every 5 seconds
    } catch (error) {
      console.error('Error processing transaction:', error instanceof Error ? error.message : String(error));
    }
  });
}

// Run the main function and catch any unhandled errors
main().catch((error) => {
  console.error('Unhandled error:', error instanceof Error ? error.message : String(error));
});



//0x2d6DA915F00dcA50b06a60fca010949382f4e0e8