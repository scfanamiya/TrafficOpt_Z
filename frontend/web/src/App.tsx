import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface TrafficData {
  id: string;
  name: string;
  encryptedSpeed: string;
  position: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [trafficData, setTrafficData] = useState<TrafficData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingData, setCreatingData] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newTrafficData, setNewTrafficData] = useState({ name: "", speed: "", position: "" });
  const [selectedData, setSelectedData] = useState<TrafficData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [signalStatus, setSignalStatus] = useState("Normal");
  const [congestionLevel, setCongestionLevel] = useState(0);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const dataList: TrafficData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          dataList.push({
            id: businessId,
            name: businessData.name,
            encryptedSpeed: businessId,
            position: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setTrafficData(dataList);
      updateCongestionLevel(dataList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateCongestionLevel = (data: TrafficData[]) => {
    if (data.length === 0) {
      setCongestionLevel(0);
      setSignalStatus("Normal");
      return;
    }
    
    const totalSpeed = data.reduce((sum, item) => sum + (item.publicValue1 || 30), 0);
    const avgSpeed = totalSpeed / data.length;
    const congestion = Math.max(0, Math.min(100, 100 - (avgSpeed / 60 * 100)));
    
    setCongestionLevel(congestion);
    
    if (congestion < 30) setSignalStatus("Smooth");
    else if (congestion < 70) setSignalStatus("Normal");
    else setSignalStatus("Congested");
  };

  const createTrafficData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingData(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating traffic data with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const speedValue = parseInt(newTrafficData.speed) || 0;
      const businessId = `traffic-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, speedValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTrafficData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newTrafficData.position) || 0,
        0,
        "Traffic Speed Data"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Traffic data created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTrafficData({ name: "", speed: "", position: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingData(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available and working!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderTrafficFlow = () => {
    return (
      <div className="traffic-flow">
        <div className="flow-step">
          <div className="step-icon">🚗</div>
          <div className="step-content">
            <h4>Vehicle Encryption</h4>
            <p>Speed and position encrypted with FHE 🔐</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🌐</div>
          <div className="step-content">
            <h4>Encrypted Transmission</h4>
            <p>Data sent to traffic optimization system</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🚦</div>
          <div className="step-content">
            <h4>Homomorphic Processing</h4>
            <p>Signal timing adjusted without decryption</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">✅</div>
          <div className="step-content">
            <h4>Optimized Flow</h4>
            <p>Traffic flow improved while maintaining privacy</p>
          </div>
        </div>
      </div>
    );
  };

  const renderSignalControl = () => {
    return (
      <div className="signal-control">
        <div className="signal-status">
          <div className={`signal-light ${signalStatus.toLowerCase()}`}>
            <div className="light"></div>
            <span>{signalStatus}</span>
          </div>
          <div className="congestion-meter">
            <div className="meter-label">Congestion Level</div>
            <div className="meter-bar">
              <div 
                className="meter-fill" 
                style={{ width: `${congestionLevel}%` }}
              ></div>
            </div>
            <div className="meter-value">{congestionLevel.toFixed(0)}%</div>
          </div>
        </div>
        
        <div className="signal-timing">
          <h4>Signal Timing Adjustment</h4>
          <div className="timing-display">
            <div className="timing-item">
              <span>Green Light:</span>
              <strong>{congestionLevel < 30 ? 45 : congestionLevel < 70 ? 30 : 60}s</strong>
            </div>
            <div className="timing-item">
              <span>Red Light:</span>
              <strong>{congestionLevel < 30 ? 30 : congestionLevel < 70 ? 45 : 30}s</strong>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Traffic Optimizer 🚦</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🚗</div>
            <h2>Connect Your Wallet to Optimize Traffic</h2>
            <p>Join our privacy-preserving traffic optimization system using Fully Homomorphic Encryption</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Encrypt your vehicle speed and position data</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Contribute to smarter traffic light timing</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Traffic System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted traffic data...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Traffic Optimizer 🚦</h1>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            Check System
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + Add Vehicle Data
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="traffic-overview">
          <h2>Real-time Traffic Optimization</h2>
          {renderTrafficFlow()}
          
          <div className="traffic-panel">
            <h3>Current Traffic Conditions</h3>
            {renderSignalControl()}
          </div>
        </div>
        
        <div className="data-section">
          <div className="section-header">
            <h2>Vehicle Data Contributions</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="data-list">
            {trafficData.length === 0 ? (
              <div className="no-data">
                <p>No traffic data found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Data Point
                </button>
              </div>
            ) : trafficData.map((data, index) => (
              <div 
                className={`data-item ${selectedData?.id === data.id ? "selected" : ""} ${data.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedData(data)}
              >
                <div className="data-title">{data.name}</div>
                <div className="data-meta">
                  <span>Position: {data.publicValue1}</span>
                  <span>Time: {new Date(data.timestamp * 1000).toLocaleTimeString()}</span>
                </div>
                <div className="data-status">
                  Status: {data.isVerified ? "✅ Verified" : "🔓 Ready for Verification"}
                  {data.isVerified && data.decryptedValue && (
                    <span className="verified-speed">Speed: {data.decryptedValue} km/h</span>
                  )}
                </div>
                <div className="data-creator">By: {data.creator.substring(0, 6)}...{data.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateData 
          onSubmit={createTrafficData} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingData} 
          data={newTrafficData} 
          setData={setNewTrafficData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedData && (
        <DataDetailModal 
          data={selectedData} 
          onClose={() => { 
            setSelectedData(null); 
            setDecryptedValue(null); 
          }} 
          decryptedValue={decryptedValue} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedData.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateData: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  data: any;
  setData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, data, setData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'speed') {
      const intValue = value.replace(/[^\d]/g, '');
      setData({ ...data, [name]: intValue });
    } else {
      setData({ ...data, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-data-modal">
        <div className="modal-header">
          <h2>Add Vehicle Traffic Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Privacy Protection</strong>
            <p>Your speed data will be encrypted - traffic lights can optimize timing without seeing your actual speed</p>
          </div>
          
          <div className="form-group">
            <label>Vehicle Identifier *</label>
            <input 
              type="text" 
              name="name" 
              value={data.name} 
              onChange={handleChange} 
              placeholder="Enter vehicle name or ID..." 
            />
          </div>
          
          <div className="form-group">
            <label>Speed (km/h, Integer only) *</label>
            <input 
              type="number" 
              name="speed" 
              value={data.speed} 
              onChange={handleChange} 
              placeholder="Enter speed value..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Position Zone (1-100) *</label>
            <input 
              type="number" 
              min="1" 
              max="100" 
              name="position" 
              value={data.position} 
              onChange={handleChange} 
              placeholder="Enter position zone..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !data.name || !data.speed || !data.position} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Submitting..." : "Submit Data"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DataDetailModal: React.FC<{
  data: any;
  onClose: () => void;
  decryptedValue: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ data, onClose, decryptedValue, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) return;
    
    const decrypted = await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="data-detail-modal">
        <div className="modal-header">
          <h2>Traffic Data Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="data-info">
            <div className="info-item">
              <span>Vehicle:</span>
              <strong>{data.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{data.creator.substring(0, 6)}...{data.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Time Recorded:</span>
              <strong>{new Date(data.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Position Zone:</span>
              <strong>{data.publicValue1}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Speed Data</h3>
            
            <div className="data-row">
              <div className="data-label">Speed Value:</div>
              <div className="data-value">
                {data.isVerified && data.decryptedValue ? 
                  `${data.decryptedValue} km/h (Verified)` : 
                  decryptedValue !== null ? 
                  `${decryptedValue} km/h (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(data.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : data.isVerified ? (
                  "✅ Verified"
                ) : decryptedValue !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Data"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>Privacy-Preserving Traffic Optimization</strong>
                <p>Your speed is encrypted using FHE. Traffic signals can adjust timing based on encrypted data without ever seeing your actual speed.</p>
              </div>
            </div>
          </div>
          
          {(data.isVerified || decryptedValue !== null) && (
            <div className="impact-section">
              <h3>Traffic Impact Analysis</h3>
              <div className="impact-metrics">
                <div className="metric">
                  <span>Signal Adjustment:</span>
                  <strong>+{(data.isVerified ? data.decryptedValue : decryptedValue || 0) * 0.1}s</strong>
                </div>
                <div className="metric">
                  <span>Flow Improvement:</span>
                  <strong>{(data.isVerified ? data.decryptedValue : decryptedValue || 0) * 0.5}%</strong>
                </div>
                <div className="metric">
                  <span>Wait Time Reduction:</span>
                  <strong>-{(data.isVerified ? data.decryptedValue : decryptedValue || 0) * 0.2}s</strong>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!data.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;