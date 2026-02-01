//! Solana Transaction Decoder
//! Parses base64/base58 encoded transactions and extracts human-readable info

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};

// Well-known Solana program IDs
const SYSTEM_PROGRAM: &str = "11111111111111111111111111111111";
const TOKEN_PROGRAM: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ASSOCIATED_TOKEN_PROGRAM: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const MEMO_PROGRAM: &str = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const COMPUTE_BUDGET_PROGRAM: &str = "ComputeBudget111111111111111111111111111111";

// Known drainer/scam program patterns (for detection)
const SUSPICIOUS_PROGRAMS: &[&str] = &[
    // Add known malicious program IDs here as they're discovered
];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DecodedTransaction {
    pub summary: String,
    pub instructions: Vec<DecodedInstruction>,
    pub warnings: Vec<TransactionWarning>,
    pub accounts_involved: Vec<String>,
    pub estimated_cost: Option<f64>, // in SOL
    pub risk_level: RiskLevel,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DecodedInstruction {
    pub program: String,
    pub program_id: String,
    pub action: String,
    pub details: InstructionDetails,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum InstructionDetails {
    SolTransfer {
        from: String,
        to: String,
        amount_lamports: u64,
        amount_sol: f64,
    },
    TokenTransfer {
        from: String,
        to: String,
        amount: u64,
        decimals: Option<u8>,
    },
    TokenApprove {
        source: String,
        delegate: String,
        amount: u64,
    },
    TokenRevoke {
        source: String,
    },
    SetComputeLimit {
        units: u32,
    },
    SetComputePrice {
        micro_lamports: u64,
    },
    Unknown {
        data_preview: String,
        accounts: Vec<String>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TransactionWarning {
    pub level: WarningLevel,
    pub title: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum WarningLevel {
    Info,
    Warning,
    Danger,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

/// Decode a transaction from base64 or base58 encoding
pub fn decode_transaction(encoded: &str) -> Result<DecodedTransaction, String> {
    // Try base64 first (most common for signTransaction)
    let tx_bytes = if let Ok(bytes) = BASE64.decode(encoded) {
        bytes
    } else if let Ok(bytes) = bs58::decode(encoded).into_vec() {
        bytes
    } else {
        return Err("Failed to decode transaction: not valid base64 or base58".into());
    };

    parse_transaction_bytes(&tx_bytes)
}

/// Parse raw transaction bytes
fn parse_transaction_bytes(bytes: &[u8]) -> Result<DecodedTransaction, String> {
    if bytes.len() < 4 {
        return Err("Transaction too short".into());
    }

    let mut offset = 0;

    // Read number of signatures (compact-u16)
    let (num_signatures, sig_len) = read_compact_u16(bytes, offset)?;
    offset += sig_len;

    // Skip signatures (each is 64 bytes)
    offset += (num_signatures as usize) * 64;

    if offset >= bytes.len() {
        return Err("Transaction truncated after signatures".into());
    }

    // Parse the message
    let message_bytes = &bytes[offset..];
    parse_message(message_bytes, num_signatures as usize)
}

/// Parse the transaction message
fn parse_message(bytes: &[u8], _num_signatures: usize) -> Result<DecodedTransaction, String> {
    if bytes.is_empty() {
        return Err("Empty message".into());
    }

    let mut offset = 0;

    // Message header (3 bytes)
    if bytes.len() < 3 {
        return Err("Message header too short".into());
    }
    let num_required_signatures = bytes[0];
    let _num_readonly_signed = bytes[1];
    let _num_readonly_unsigned = bytes[2];
    offset += 3;

    // Read account keys
    let (num_accounts, len) = read_compact_u16(bytes, offset)?;
    offset += len;

    let mut account_keys: Vec<String> = Vec::with_capacity(num_accounts as usize);
    for _ in 0..num_accounts {
        if offset + 32 > bytes.len() {
            return Err("Account keys truncated".into());
        }
        let pubkey = bs58::encode(&bytes[offset..offset + 32]).into_string();
        account_keys.push(pubkey);
        offset += 32;
    }

    // Recent blockhash (32 bytes)
    if offset + 32 > bytes.len() {
        return Err("Recent blockhash truncated".into());
    }
    offset += 32;

    // Read instructions
    let (num_instructions, len) = read_compact_u16(bytes, offset)?;
    offset += len;

    let mut instructions: Vec<DecodedInstruction> = Vec::new();
    let mut warnings: Vec<TransactionWarning> = Vec::new();
    let mut total_sol_out: f64 = 0.0;

    for _ in 0..num_instructions {
        if offset >= bytes.len() {
            break;
        }

        // Program ID index
        let program_id_index = bytes[offset] as usize;
        offset += 1;

        let program_id = account_keys
            .get(program_id_index)
            .cloned()
            .unwrap_or_else(|| "Unknown".to_string());

        // Account indices
        let (num_accounts, len) = read_compact_u16(bytes, offset)?;
        offset += len;

        let mut account_indices: Vec<usize> = Vec::new();
        for _ in 0..num_accounts {
            if offset >= bytes.len() {
                break;
            }
            account_indices.push(bytes[offset] as usize);
            offset += 1;
        }

        // Instruction data
        let (data_len, len) = read_compact_u16(bytes, offset)?;
        offset += len;

        let instruction_data = if offset + data_len as usize <= bytes.len() {
            bytes[offset..offset + data_len as usize].to_vec()
        } else {
            Vec::new()
        };
        offset += data_len as usize;

        // Decode the instruction based on program
        let decoded = decode_instruction(
            &program_id,
            &account_indices,
            &instruction_data,
            &account_keys,
        );

        // Track SOL outflows
        if let InstructionDetails::SolTransfer { amount_sol, .. } = &decoded.details {
            total_sol_out += amount_sol;
        }

        // Check for suspicious patterns
        if SUSPICIOUS_PROGRAMS.contains(&program_id.as_str()) {
            warnings.push(TransactionWarning {
                level: WarningLevel::Danger,
                title: "Known Malicious Program".into(),
                message: format!("This transaction interacts with a known drainer: {}", program_id),
            });
        }

        // Check for token approvals (potential for unlimited drain)
        if let InstructionDetails::TokenApprove { amount, .. } = &decoded.details {
            if *amount == u64::MAX {
                warnings.push(TransactionWarning {
                    level: WarningLevel::Danger,
                    title: "Unlimited Token Approval".into(),
                    message: "This approves UNLIMITED tokens to be spent. This is extremely risky!".into(),
                });
            } else if *amount > 1_000_000_000 {
                warnings.push(TransactionWarning {
                    level: WarningLevel::Warning,
                    title: "Large Token Approval".into(),
                    message: format!("Approving {} tokens - verify this is intended.", amount),
                });
            }
        }

        instructions.push(decoded);
    }

    // Calculate risk level
    let risk_level = calculate_risk_level(&instructions, &warnings, total_sol_out);

    // Generate summary
    let summary = generate_summary(&instructions, total_sol_out, num_required_signatures);

    // Add warnings for high-value transactions
    if total_sol_out > 1.0 {
        warnings.push(TransactionWarning {
            level: WarningLevel::Warning,
            title: "High Value Transaction".into(),
            message: format!("This transaction sends {:.4} SOL", total_sol_out),
        });
    }

    Ok(DecodedTransaction {
        summary,
        instructions,
        warnings,
        accounts_involved: account_keys,
        estimated_cost: Some(total_sol_out),
        risk_level,
    })
}

/// Decode a single instruction
fn decode_instruction(
    program_id: &str,
    account_indices: &[usize],
    data: &[u8],
    account_keys: &[String],
) -> DecodedInstruction {
    let get_account = |idx: usize| -> String {
        account_indices
            .get(idx)
            .and_then(|&i| account_keys.get(i))
            .cloned()
            .unwrap_or_else(|| "Unknown".to_string())
    };

    match program_id {
        p if p == SYSTEM_PROGRAM => decode_system_instruction(data, &get_account),
        p if p == TOKEN_PROGRAM || p == TOKEN_2022_PROGRAM => {
            decode_token_instruction(data, &get_account, program_id)
        }
        p if p == COMPUTE_BUDGET_PROGRAM => decode_compute_budget_instruction(data),
        p if p == MEMO_PROGRAM => DecodedInstruction {
            program: "Memo".into(),
            program_id: program_id.to_string(),
            action: "Add Memo".into(),
            details: InstructionDetails::Unknown {
                data_preview: String::from_utf8_lossy(data).to_string(),
                accounts: account_indices
                    .iter()
                    .filter_map(|&i| account_keys.get(i).cloned())
                    .collect(),
            },
        },
        _ => DecodedInstruction {
            program: shorten_address(program_id),
            program_id: program_id.to_string(),
            action: "Unknown Program Call".into(),
            details: InstructionDetails::Unknown {
                data_preview: if data.len() > 32 {
                    format!("{}...", hex::encode(&data[..32]))
                } else {
                    hex::encode(data)
                },
                accounts: account_indices
                    .iter()
                    .filter_map(|&i| account_keys.get(i).cloned())
                    .collect(),
            },
        },
    }
}

/// Decode System Program instruction
fn decode_system_instruction<F: Fn(usize) -> String>(data: &[u8], get_account: &F) -> DecodedInstruction {
    if data.is_empty() {
        return DecodedInstruction {
            program: "System".into(),
            program_id: SYSTEM_PROGRAM.to_string(),
            action: "Unknown".into(),
            details: InstructionDetails::Unknown {
                data_preview: "".into(),
                accounts: vec![],
            },
        };
    }

    // System program instruction discriminator is first 4 bytes (little-endian u32)
    let instruction_type = if data.len() >= 4 {
        u32::from_le_bytes([data[0], data[1], data[2], data[3]])
    } else {
        data[0] as u32
    };

    match instruction_type {
        2 => {
            // Transfer
            let lamports = if data.len() >= 12 {
                u64::from_le_bytes(data[4..12].try_into().unwrap_or([0; 8]))
            } else {
                0
            };
            let sol = lamports as f64 / 1_000_000_000.0;

            DecodedInstruction {
                program: "System".into(),
                program_id: SYSTEM_PROGRAM.to_string(),
                action: format!("Transfer {:.6} SOL", sol),
                details: InstructionDetails::SolTransfer {
                    from: get_account(0),
                    to: get_account(1),
                    amount_lamports: lamports,
                    amount_sol: sol,
                },
            }
        }
        0 => DecodedInstruction {
            program: "System".into(),
            program_id: SYSTEM_PROGRAM.to_string(),
            action: "Create Account".into(),
            details: InstructionDetails::Unknown {
                data_preview: hex::encode(data),
                accounts: vec![get_account(0), get_account(1)],
            },
        },
        1 => DecodedInstruction {
            program: "System".into(),
            program_id: SYSTEM_PROGRAM.to_string(),
            action: "Assign".into(),
            details: InstructionDetails::Unknown {
                data_preview: hex::encode(data),
                accounts: vec![get_account(0)],
            },
        },
        _ => DecodedInstruction {
            program: "System".into(),
            program_id: SYSTEM_PROGRAM.to_string(),
            action: format!("System Instruction #{}", instruction_type),
            details: InstructionDetails::Unknown {
                data_preview: hex::encode(data),
                accounts: vec![],
            },
        },
    }
}

/// Decode Token Program instruction
fn decode_token_instruction<F: Fn(usize) -> String>(
    data: &[u8],
    get_account: &F,
    program_id: &str,
) -> DecodedInstruction {
    if data.is_empty() {
        return DecodedInstruction {
            program: "Token".into(),
            program_id: program_id.to_string(),
            action: "Unknown".into(),
            details: InstructionDetails::Unknown {
                data_preview: "".into(),
                accounts: vec![],
            },
        };
    }

    let instruction_type = data[0];

    match instruction_type {
        3 => {
            // Transfer
            let amount = if data.len() >= 9 {
                u64::from_le_bytes(data[1..9].try_into().unwrap_or([0; 8]))
            } else {
                0
            };

            DecodedInstruction {
                program: "Token".into(),
                program_id: program_id.to_string(),
                action: format!("Transfer {} tokens", amount),
                details: InstructionDetails::TokenTransfer {
                    from: get_account(0),
                    to: get_account(1),
                    amount,
                    decimals: None,
                },
            }
        }
        4 => {
            // Approve
            let amount = if data.len() >= 9 {
                u64::from_le_bytes(data[1..9].try_into().unwrap_or([0; 8]))
            } else {
                0
            };

            DecodedInstruction {
                program: "Token".into(),
                program_id: program_id.to_string(),
                action: if amount == u64::MAX {
                    "Approve UNLIMITED tokens".into()
                } else {
                    format!("Approve {} tokens", amount)
                },
                details: InstructionDetails::TokenApprove {
                    source: get_account(0),
                    delegate: get_account(1),
                    amount,
                },
            }
        }
        5 => {
            // Revoke
            DecodedInstruction {
                program: "Token".into(),
                program_id: program_id.to_string(),
                action: "Revoke Approval".into(),
                details: InstructionDetails::TokenRevoke {
                    source: get_account(0),
                },
            }
        }
        12 => {
            // TransferChecked
            let amount = if data.len() >= 9 {
                u64::from_le_bytes(data[1..9].try_into().unwrap_or([0; 8]))
            } else {
                0
            };
            let decimals = if data.len() >= 10 { Some(data[9]) } else { None };

            DecodedInstruction {
                program: "Token".into(),
                program_id: program_id.to_string(),
                action: format!("Transfer {} tokens (checked)", amount),
                details: InstructionDetails::TokenTransfer {
                    from: get_account(0),
                    to: get_account(2), // TransferChecked has mint at index 1
                    amount,
                    decimals,
                },
            }
        }
        _ => DecodedInstruction {
            program: "Token".into(),
            program_id: program_id.to_string(),
            action: format!("Token Instruction #{}", instruction_type),
            details: InstructionDetails::Unknown {
                data_preview: hex::encode(data),
                accounts: vec![],
            },
        },
    }
}

/// Decode Compute Budget Program instruction
fn decode_compute_budget_instruction(data: &[u8]) -> DecodedInstruction {
    if data.is_empty() {
        return DecodedInstruction {
            program: "Compute Budget".into(),
            program_id: COMPUTE_BUDGET_PROGRAM.to_string(),
            action: "Unknown".into(),
            details: InstructionDetails::Unknown {
                data_preview: "".into(),
                accounts: vec![],
            },
        };
    }

    match data[0] {
        2 => {
            // SetComputeUnitLimit
            let units = if data.len() >= 5 {
                u32::from_le_bytes(data[1..5].try_into().unwrap_or([0; 4]))
            } else {
                0
            };
            DecodedInstruction {
                program: "Compute Budget".into(),
                program_id: COMPUTE_BUDGET_PROGRAM.to_string(),
                action: format!("Set compute limit to {} units", units),
                details: InstructionDetails::SetComputeLimit { units },
            }
        }
        3 => {
            // SetComputeUnitPrice
            let micro_lamports = if data.len() >= 9 {
                u64::from_le_bytes(data[1..9].try_into().unwrap_or([0; 8]))
            } else {
                0
            };
            DecodedInstruction {
                program: "Compute Budget".into(),
                program_id: COMPUTE_BUDGET_PROGRAM.to_string(),
                action: format!("Set priority fee to {} micro-lamports/CU", micro_lamports),
                details: InstructionDetails::SetComputePrice { micro_lamports },
            }
        }
        _ => DecodedInstruction {
            program: "Compute Budget".into(),
            program_id: COMPUTE_BUDGET_PROGRAM.to_string(),
            action: format!("Compute Budget #{}", data[0]),
            details: InstructionDetails::Unknown {
                data_preview: hex::encode(data),
                accounts: vec![],
            },
        },
    }
}

/// Read a compact-u16 (Solana's variable-length encoding)
fn read_compact_u16(bytes: &[u8], offset: usize) -> Result<(u16, usize), String> {
    if offset >= bytes.len() {
        return Err("Offset out of bounds".into());
    }

    let first = bytes[offset] as u16;
    if first < 0x80 {
        return Ok((first, 1));
    }

    if offset + 1 >= bytes.len() {
        return Err("Compact-u16 truncated".into());
    }

    let second = bytes[offset + 1] as u16;
    if second < 0x80 {
        return Ok(((first & 0x7f) | (second << 7), 2));
    }

    if offset + 2 >= bytes.len() {
        return Err("Compact-u16 truncated".into());
    }

    let third = bytes[offset + 2] as u16;
    Ok(((first & 0x7f) | ((second & 0x7f) << 7) | (third << 14), 3))
}

/// Calculate risk level based on transaction contents
fn calculate_risk_level(
    instructions: &[DecodedInstruction],
    warnings: &[TransactionWarning],
    total_sol_out: f64,
) -> RiskLevel {
    // Any danger warnings = Critical
    if warnings.iter().any(|w| w.level == WarningLevel::Danger) {
        return RiskLevel::Critical;
    }

    // High value transfers
    if total_sol_out > 10.0 {
        return RiskLevel::High;
    }
    if total_sol_out > 1.0 {
        return RiskLevel::Medium;
    }

    // Many unknown program calls
    let unknown_count = instructions
        .iter()
        .filter(|i| matches!(i.details, InstructionDetails::Unknown { .. }))
        .count();

    if unknown_count > 3 {
        return RiskLevel::Medium;
    }

    // Token approvals
    let has_approval = instructions
        .iter()
        .any(|i| matches!(i.details, InstructionDetails::TokenApprove { .. }));

    if has_approval {
        return RiskLevel::Medium;
    }

    RiskLevel::Low
}

/// Generate human-readable summary
fn generate_summary(instructions: &[DecodedInstruction], total_sol_out: f64, _num_sigs: u8) -> String {
    let mut parts: Vec<String> = Vec::new();

    // Count instruction types
    let mut sol_transfers = 0;
    let mut token_transfers = 0;
    let mut approvals = 0;
    let mut unknown = 0;

    for inst in instructions {
        match &inst.details {
            InstructionDetails::SolTransfer { .. } => sol_transfers += 1,
            InstructionDetails::TokenTransfer { .. } => token_transfers += 1,
            InstructionDetails::TokenApprove { .. } => approvals += 1,
            InstructionDetails::Unknown { .. } => unknown += 1,
            _ => {}
        }
    }

    if sol_transfers > 0 {
        parts.push(format!("Transfer {:.4} SOL", total_sol_out));
    }
    if token_transfers > 0 {
        parts.push(format!(
            "{} token transfer{}",
            token_transfers,
            if token_transfers > 1 { "s" } else { "" }
        ));
    }
    if approvals > 0 {
        parts.push(format!(
            "{} token approval{}",
            approvals,
            if approvals > 1 { "s" } else { "" }
        ));
    }
    if unknown > 0 {
        parts.push(format!(
            "{} program call{}",
            unknown,
            if unknown > 1 { "s" } else { "" }
        ));
    }

    if parts.is_empty() {
        "Transaction with no detected transfers".into()
    } else {
        parts.join(", ")
    }
}

/// Shorten an address for display
fn shorten_address(addr: &str) -> String {
    if addr.len() > 12 {
        format!("{}...{}", &addr[..4], &addr[addr.len() - 4..])
    } else {
        addr.to_string()
    }
}

// Add hex encoding helper
mod hex {
    pub fn encode(data: &[u8]) -> String {
        data.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_empty_transaction() {
        let result = decode_transaction("");
        assert!(result.is_err());
    }

    #[test]
    fn test_shorten_address() {
        let addr = "11111111111111111111111111111111";
        assert_eq!(shorten_address(addr), "1111...1111");
    }
}
