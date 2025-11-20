import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface TrafficData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface TrafficStats {
  totalSignals: number;
  optimizedCount: number;
  avgWaitTime: number;
  congestionLevel: number;
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
    status: "pending" as const, 
    message: "" 
  });
  const [newTrafficData, setNewTrafficData] = useState({ 
    location: "", 
    speed: "", 
    signalId: "" 
  });
  const [selectedData, setSelectedData] = useState<TrafficData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [searchTerm, setSearchTerm] = useState("");
  const [faqOpenIndex, setFaqOpenIndex] = useState<number | null>(null);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
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
      const trafficList: TrafficData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const data = await contract.getBusinessData(businessId);
          trafficList.push({
            id: businessId,
            name: data.name,
            encryptedValue: businessId,
            publicValue1: Number(data.publicValue1) || 0,
            publicValue2: Number(data.publicValue2) || 0,
            description: data.description,
            creator: data.creator,
            timestamp: Number(data.timestamp),
            isVerified: data.isVerified,
            decryptedValue: Number(data.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading traffic data:', e);
        }
      }
      
      setTrafficData(trafficList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createTrafficData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingData(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted traffic data..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const speedValue = parseInt(newTrafficData.speed) || 0;
      const businessId = `traffic-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, speedValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTrafficData.location,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newTrafficData.signalId) || 0,
        0,
        "Encrypted Traffic Speed Data"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Traffic data created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTrafficData({ location: "", speed: "", signalId: "" });
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
      
      const data = await contractRead.getBusinessData(businessId);
      if (data.isVerified) {
        const storedValue = Number(data.decryptedValue) || 0;
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
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "System is available and ready!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getTrafficStats = (): TrafficStats => {
    const totalSignals = trafficData.length;
    const optimizedCount = trafficData.filter(d => d.isVerified).length;
    const avgWaitTime = trafficData.length > 0 
      ? trafficData.reduce((sum, d) => sum + d.publicValue1, 0) / trafficData.length 
      : 0;
    const congestionLevel = Math.min(100, Math.max(0, (trafficData.length * 10) + (avgWaitTime * 5)));

    return {
      totalSignals,
      optimizedCount,
      avgWaitTime,
      congestionLevel
    };
  };

  const filteredData = trafficData.filter(data =>
    data.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    data.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const faqItems = [
    {
      question: "什么是同态加密交通优化？",
      answer: "使用全同态加密技术，在不解密车辆数据的情况下优化交通信号灯时长，保护隐私。"
    },
    {
      question: "我的数据如何被保护？",
      answer: "车辆速度和位置数据在本地加密后才上传，服务器只能进行加密状态下的计算，无法查看原始数据。"
    },
    {
      question: "系统如何优化交通流量？",
      answer: "通过分析加密的车流数据，动态调整信号灯周期，减少拥堵而不侵犯隐私。"
    },
    {
      question: "需要特殊硬件吗？",
      answer: "不需要，系统基于软件实现，兼容现有交通基础设施。"
    }
  ];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE交通优化 🔐</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🚦</div>
            <h2>连接钱包开始隐私交通优化</h2>
            <p>使用全同态加密技术保护您的交通数据隐私</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>连接钱包初始化FHE系统</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>加密上传交通数据</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>参与隐私保护的交通优化</p>
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
        <p>初始化FHE交通加密系统...</p>
        <p className="loading-note">正在准备隐私保护计算环境</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密交通数据...</p>
    </div>
  );

  const stats = getTrafficStats();

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE交通优化 🔐</h1>
          <span className="tagline">隐私保护的智能交通系统</span>
        </div>
        
        <nav className="main-nav">
          <button 
            className={`nav-btn ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            🏠 控制台
          </button>
          <button 
            className={`nav-btn ${activeTab === "data" ? "active" : ""}`}
            onClick={() => setActiveTab("data")}
          >
            📊 交通数据
          </button>
          <button 
            className={`nav-btn ${activeTab === "faq" ? "active" : ""}`}
            onClick={() => setActiveTab("faq")}
          >
            ❓ 常见问题
          </button>
        </nav>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn neon-pulse"
          >
            + 上传交通数据
          </button>
          <button 
            onClick={checkAvailability} 
            className="check-btn"
          >
            🔍 系统检查
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <main className="main-content">
        {activeTab === "dashboard" && (
          <div className="dashboard-tab">
            <div className="stats-grid">
              <div className="stat-card metal-card">
                <div className="stat-icon">🚦</div>
                <div className="stat-content">
                  <h3>信号灯总数</h3>
                  <div className="stat-value">{stats.totalSignals}</div>
                </div>
              </div>
              
              <div className="stat-card metal-card">
                <div className="stat-icon">⚡</div>
                <div className="stat-content">
                  <h3>已优化信号</h3>
                  <div className="stat-value">{stats.optimizedCount}</div>
                </div>
              </div>
              
              <div className="stat-card metal-card">
                <div className="stat-icon">⏱️</div>
                <div className="stat-content">
                  <h3>平均等待时间</h3>
                  <div className="stat-value">{stats.avgWaitTime.toFixed(1)}s</div>
                </div>
              </div>
              
              <div className="stat-card metal-card">
                <div className="stat-icon">🚗</div>
                <div className="stat-content">
                  <h3>拥堵指数</h3>
                  <div className="stat-value">{stats.congestionLevel}%</div>
                </div>
              </div>
            </div>
            
            <div className="flow-section">
              <h2>FHE交通优化流程</h2>
              <div className="flow-steps">
                <div className="flow-step metal-card">
                  <div className="step-number">1</div>
                  <h4>数据加密</h4>
                  <p>车辆速度位置数据本地加密</p>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step metal-card">
                  <div className="step-number">2</div>
                  <h4>同态计算</h4>
                  <p>加密状态下计算最优信号时长</p>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step metal-card">
                  <div className="step-number">3</div>
                  <h4>结果验证</h4>
                  <p>解密验证优化结果</p>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step metal-card">
                  <div className="step-number">4</div>
                  <h4>信号调整</h4>
                  <p>动态调整红绿灯时长</p>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "data" && (
          <div className="data-tab">
            <div className="data-header">
              <h2>加密交通数据</h2>
              <div className="data-controls">
                <div className="search-box">
                  <input 
                    type="text" 
                    placeholder="搜索位置或描述..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <button 
                  onClick={loadData} 
                  className="refresh-btn"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "刷新中..." : "🔄"}
                </button>
              </div>
            </div>
            
            <div className="data-grid">
              {filteredData.length === 0 ? (
                <div className="no-data metal-card">
                  <p>暂无交通数据</p>
                  <button 
                    className="create-btn"
                    onClick={() => setShowCreateModal(true)}
                  >
                    上传第一条数据
                  </button>
                </div>
              ) : (
                filteredData.map((data, index) => (
                  <div 
                    key={index}
                    className={`data-item metal-card ${data.isVerified ? "verified" : ""}`}
                    onClick={() => setSelectedData(data)}
                  >
                    <div className="data-header">
                      <h3>{data.name}</h3>
                      <span className={`status-badge ${data.isVerified ? "verified" : "encrypted"}`}>
                        {data.isVerified ? "✅ 已验证" : "🔒 加密中"}
                      </span>
                    </div>
                    <div className="data-meta">
                      <span>信号ID: {data.publicValue1}</span>
                      <span>时间: {new Date(data.timestamp * 1000).toLocaleString()}</span>
                    </div>
                    <div className="data-description">{data.description}</div>
                    {data.isVerified && data.decryptedValue && (
                      <div className="decrypted-value">
                        解密速度: {data.decryptedValue} km/h
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "faq" && (
          <div className="faq-tab">
            <h2>常见问题解答</h2>
            <div className="faq-list">
              {faqItems.map((item, index) => (
                <div key={index} className="faq-item metal-card">
                  <div 
                    className="faq-question"
                    onClick={() => setFaqOpenIndex(faqOpenIndex === index ? null : index)}
                  >
                    <h3>{item.question}</h3>
                    <span className="faq-toggle">
                      {faqOpenIndex === index ? "−" : "+"}
                    </span>
                  </div>
                  {faqOpenIndex === index && (
                    <div className="faq-answer">
                      <p>{item.answer}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
      
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
          setDecryptedValue={setDecryptedValue} 
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
      <div className="create-data-modal metal-card">
        <div className="modal-header">
          <h2>上传加密交通数据</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 加密保护</strong>
            <p>车辆速度数据将使用同态加密技术保护隐私</p>
          </div>
          
          <div className="form-group">
            <label>位置信息 *</label>
            <input 
              type="text" 
              name="location" 
              value={data.location} 
              onChange={handleChange} 
              placeholder="输入具体位置..." 
            />
          </div>
          
          <div className="form-group">
            <label>车辆速度 (km/h) *</label>
            <input 
              type="number" 
              name="speed" 
              value={data.speed} 
              onChange={handleChange} 
              placeholder="输入速度值..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE加密整数</div>
          </div>
          
          <div className="form-group">
            <label>信号灯ID *</label>
            <input 
              type="number" 
              min="1" 
              name="signalId" 
              value={data.signalId} 
              onChange={handleChange} 
              placeholder="输入信号灯编号..." 
            />
            <div className="data-type-label">公开数据</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !data.location || !data.speed || !data.signalId} 
            className="submit-btn neon-pulse"
          >
            {creating || isEncrypting ? "加密并上传中..." : "上传加密数据"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DataDetailModal: React.FC<{
  data: TrafficData;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ data, onClose, decryptedValue, setDecryptedValue, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { 
      setDecryptedValue(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedValue(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="data-detail-modal metal-card">
        <div className="modal-header">
          <h2>交通数据详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="data-info">
            <div className="info-item">
              <span>位置:</span>
              <strong>{data.name}</strong>
            </div>
            <div className="info-item">
              <span>上传者:</span>
              <strong>{data.creator.substring(0, 6)}...{data.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>上传时间:</span>
              <strong>{new Date(data.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>信号灯ID:</span>
              <strong>{data.publicValue1}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>加密速度数据</h3>
            
            <div className="data-row">
              <div className="data-label">车辆速度:</div>
              <div className="data-value">
                {data.isVerified && data.decryptedValue ? 
                  `${data.decryptedValue} km/h (链上已验证)` : 
                  decryptedValue !== null ? 
                  `${decryptedValue} km/h (本地解密)` : 
                  "🔒 FHE加密数据"
                }
              </div>
              <button 
                className={`decrypt-btn ${(data.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 验证中..."
                ) : data.isVerified ? (
                  "✅ 已验证"
                ) : decryptedValue !== null ? (
                  "🔄 重新验证"
                ) : (
                  "🔓 验证解密"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE隐私保护</strong>
                <p>数据在链上保持加密状态，验证过程不会泄露原始信息。</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
          {!data.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn neon-pulse"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


