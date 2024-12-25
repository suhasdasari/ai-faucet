// Import required dependencies
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, Address, Hash, Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import networks, { 
  NetworkConfig, 
  getAvailableNetworks,
  getNetwork 
} from './networks';

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

// Update getNetworksFromInput function
function getNetworksFromInput(input: string): string[] {
  const inputLower = input.toLowerCase();
  const availableNetworks = getAvailableNetworks();
  
  // Check for "both" or "all" keywords
  if (inputLower.includes('both') || inputLower.includes('all')) {
    return availableNetworks;
  }

  // Return all mentioned networks that exist in our configuration
  return availableNetworks.filter(network => 
    inputLower.includes(network.toLowerCase())
  );
}

// Create an account from the private key
const account = privateKeyToAccount(privateKey);

// Function to get AI response from OpenAI
async function getAIResponse(prompt: string): Promise<string> {
  const networkConfigs = Object.entries(networks).map(([name, config]) => ({
    name,
    symbol: config.faucet.symbol,
    amount: config.faucet.amount
  }));

  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: `You are a helpful faucet bot that sends test tokens. Available networks and configurations:
        ${JSON.stringify(networkConfigs, null, 2)}

        Important rules for understanding user requests:
        1. Handle common typos and mistakes:
           - "ti" → assume they meant "to"
           - "sepholia", "sepholio" → assume they meant "sepolia"
           - "sherdum", "shardium" → assume they meant "shardeum"
           - "polygn", "ploygon" → assume they meant "polygon"
           - "optimisim", "optmism" → assume they meant "optimism"

        2. When you detect typos, include a warning to help the user:
           - "Note: Assuming 'ti' means 'to'"
           - "Note: Assuming 'sepholia' means 'sepolia'"

        3. If you don't understand the request or it's too unclear, respond with:
        {
          "error": "I'm not sure what you're asking. Did you mean to say:\n- send tokens to 0x... on sepolia\n- send test tokens on all networks to 0x..."
        }

        4. For valid requests (even with correctable typos), respond in this format:
        {
          "to": "ethereum_address",
          "networks": [
            {
              "name": "network_name",
              "amount": "predefined_amount",
              "symbol": "token_symbol"
            }
          ],
          "explanation": "brief_description",
          "warnings": [
            "Note: Corrected 'ti' to 'to'",
            "Note: Corrected 'sepholia' to 'sepolia'",
            "Note: Using SHM for Shardeum instead of ETH"
          ]
        }

        Remember:
        - For Shardeum: use SHM tokens (not ETH)
        - For Polygon: use POL tokens (not ETH)
        - Use predefined amounts for each network
        - Include all requested networks in response
        - Always try to understand what the user meant, even with typos`
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.3,
  });

  return response.choices[0].message.content || '';
}

// Function to parse AI response into transaction details
function parseAIResponse(response: string): { 
  to: string; 
  networks: Array<{ name: string; amount: string; symbol: string }>;
  explanation: string;
  warnings?: string[];
} {
  try {
    const cleanResponse = response.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleanResponse);

    // Check if AI didn't understand the request
    if (parsed.error) {
      console.log('\n❌ ' + parsed.error);
      throw new Error('AI could not understand the request');
    }
    
    // Validate required fields
    if (!parsed.to || !parsed.networks || !parsed.explanation) {
      throw new Error('Missing required fields in response');
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/i.test(parsed.to)) {
      throw new Error('Invalid Ethereum address format');
    }

    return parsed;
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message === 'AI could not understand the request') {
        throw error;
      }
      console.error('Parse Error:', error);
    }
    throw new Error('Failed to parse AI response. Please try again with a simpler request.');
  }
}

// Modified makeTransaction function
async function makeTransaction(
  to: Address, 
  amount: string, 
  networkName: string
): Promise<Hash> {
  const network = getNetwork(networkName);
  if (!network) {
    throw new Error(`Network ${networkName} not configured`);
  }

  const publicClient = network.publicClient;
  const walletClient = network.walletClient(account);
  
  const balance = await publicClient.getBalance({ address: account.address });
  const value = parseEther(amount);
  
  if (balance < value) {
    throw new Error(
      `Faucet is currently drained for ${networkName}. We will refill it soon. ` +
      `Current balance: ${formatEther(balance)} ${network.faucet.symbol}`
    );
  }

  const hash = await walletClient.sendTransaction({
    to,
    value,
    chain: network.chain,
  } as any) as Hash;

  return hash;
}

// Modified getTransactionStatus function
async function getTransactionStatus(hash: Hash, networkName: string): Promise<string> {
  const network = getNetwork(networkName);
  if (!network) {
    throw new Error(`Network ${networkName} not configured`);
  }

  try {
    const receipt = await network.publicClient.getTransactionReceipt({ hash });
    return receipt.status === 'success' ? 'Success' : 'Failed';
  } catch (error) {
    if (error instanceof Error && error.message.includes('could not be found')) {
      return 'Pending';
    }
    console.error('Error getting transaction status:', error);
    return 'Unknown';
  }
}

// Add a function to handle multiple transactions
async function makeMultipleTransactions(
  to: Address,
  networkConfigs: Array<{ name: string; amount: string; symbol: string }>
): Promise<{ network: string; result: { hash: Hash; status: string } | { error: string } }[]> {
  const results = [];

  for (const { name, amount } of networkConfigs) {
    try {
      const hash = await makeTransaction(to, amount, name);
      const status = await getTransactionStatus(hash, name);
      results.push({
        network: name,
        result: { hash, status }
      });
    } catch (error) {
      results.push({
        network: name,
        result: { error: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  return results;
}

// Modified main function
async function main() {
  console.log('🤖 AI Ethereum Agent Faucet');
  console.log('💡 Example: "send test tokens to 0x... on sepolia" or "send tokens on all networks to 0x..."');
  console.log('\nEnter your request:');

  process.stdin.on('data', async (data) => {
    const userInput = data.toString().trim();
    
    try {
      const aiResponse = await getAIResponse(userInput);
      const parsed = parseAIResponse(aiResponse);

      // Display any warnings first
      if (parsed.warnings && parsed.warnings.length > 0) {
        console.log('\nWarnings:');
        parsed.warnings.forEach(warning => console.log(`- ${warning}`));
      }

      // If no networks to process, just return
      if (parsed.networks.length === 0) {
        console.log(`\n${parsed.explanation}`);
        return;
      }

      console.log(`\n${parsed.explanation}`);

      // Process transactions
      const results = await makeMultipleTransactions(parsed.to as Address, parsed.networks);

      // Display only final results
      for (const { network, result } of results) {
        if ('hash' in result) {
          console.log(`\nFaucet sent on ${network}:`);
          console.log(`Transaction hash: ${result.hash}`);
        } else {
          console.log(`\nFaucet failed on ${network}:`);
          console.log(`Error: ${result.error}`);
        }
      }

    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.message === 'AI could not understand the request') {
          // Already handled in parseAIResponse
        } else {
          console.error('\n❌ Error:', error.message);
        }
      } else {
        console.error('\n❌ Error:', String(error));
      }
    }
    console.log('\n💬 Enter another request:');
  });
}

// Run the main function and catch any unhandled errors
main().catch((error) => {
  console.error('Unhandled error:', error instanceof Error ? error.message : String(error));
});



//send 0.01 eth 0x2d6DA915F00dcA50b06a60fca010949382f4e0e8 on