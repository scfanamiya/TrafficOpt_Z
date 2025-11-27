pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TrafficOptimization is ZamaEthereumConfig {
    struct TrafficData {
        string intersectionId;
        euint32 encryptedVehicleSpeed;
        euint32 encryptedVehiclePosition;
        uint256 publicTrafficDensity;
        uint256 signalDuration;
        address dataProvider;
        uint256 timestamp;
        bool isAdjusted;
    }

    struct SignalAdjustment {
        string intersectionId;
        uint256 newDuration;
        address adjuster;
        uint256 timestamp;
    }

    mapping(string => TrafficData) public trafficData;
    mapping(string => SignalAdjustment[]) public signalAdjustments;
    string[] public intersectionIds;

    event TrafficDataSubmitted(string indexed intersectionId, address indexed dataProvider);
    event SignalAdjusted(string indexed intersectionId, uint256 newDuration, address indexed adjuster);

    constructor() ZamaEthereumConfig() {
    }

    function submitTrafficData(
        string calldata intersectionId,
        externalEuint32 encryptedSpeed,
        bytes calldata speedProof,
        externalEuint32 encryptedPosition,
        bytes calldata positionProof,
        uint256 trafficDensity
    ) external {
        require(bytes(trafficData[intersectionId].intersectionId).length == 0, "Intersection data exists");
        
        euint32 speed = FHE.fromExternal(encryptedSpeed, speedProof);
        euint32 position = FHE.fromExternal(encryptedPosition, positionProof);
        
        require(FHE.isInitialized(speed), "Invalid encrypted speed");
        require(FHE.isInitialized(position), "Invalid encrypted position");
        
        trafficData[intersectionId] = TrafficData({
            intersectionId: intersectionId,
            encryptedVehicleSpeed: speed,
            encryptedVehiclePosition: position,
            publicTrafficDensity: trafficDensity,
            signalDuration: 60, // Default 60 seconds
            dataProvider: msg.sender,
            timestamp: block.timestamp,
            isAdjusted: false
        });
        
        FHE.allowThis(trafficData[intersectionId].encryptedVehicleSpeed);
        FHE.allowThis(trafficData[intersectionId].encryptedVehiclePosition);
        
        FHE.makePubliclyDecryptable(trafficData[intersectionId].encryptedVehicleSpeed);
        FHE.makePubliclyDecryptable(trafficData[intersectionId].encryptedVehiclePosition);
        
        intersectionIds.push(intersectionId);
        
        emit TrafficDataSubmitted(intersectionId, msg.sender);
    }

    function adjustSignalDuration(
        string calldata intersectionId,
        uint256 newDuration
    ) external {
        require(bytes(trafficData[intersectionId].intersectionId).length > 0, "Intersection not found");
        require(newDuration >= 30 && newDuration <= 180, "Invalid duration");
        
        trafficData[intersectionId].signalDuration = newDuration;
        trafficData[intersectionId].isAdjusted = true;
        
        signalAdjustments[intersectionId].push(SignalAdjustment({
            intersectionId: intersectionId,
            newDuration: newDuration,
            adjuster: msg.sender,
            timestamp: block.timestamp
        }));
        
        emit SignalAdjusted(intersectionId, newDuration, msg.sender);
    }

    function getEncryptedSpeed(string calldata intersectionId) external view returns (euint32) {
        require(bytes(trafficData[intersectionId].intersectionId).length > 0, "Intersection not found");
        return trafficData[intersectionId].encryptedVehicleSpeed;
    }

    function getEncryptedPosition(string calldata intersectionId) external view returns (euint32) {
        require(bytes(trafficData[intersectionId].intersectionId).length > 0, "Intersection not found");
        return trafficData[intersectionId].encryptedVehiclePosition;
    }

    function getTrafficData(string calldata intersectionId) external view returns (
        string memory intersectionId_,
        uint256 publicTrafficDensity,
        uint256 signalDuration,
        address dataProvider,
        uint256 timestamp,
        bool isAdjusted
    ) {
        require(bytes(trafficData[intersectionId].intersectionId).length > 0, "Intersection not found");
        TrafficData storage data = trafficData[intersectionId];
        
        return (
            data.intersectionId,
            data.publicTrafficDensity,
            data.signalDuration,
            data.dataProvider,
            data.timestamp,
            data.isAdjusted
        );
    }

    function getSignalAdjustments(string calldata intersectionId) external view returns (
        uint256[] memory newDurations,
        address[] memory adjusters,
        uint256[] memory timestamps
    ) {
        require(bytes(trafficData[intersectionId].intersectionId).length > 0, "Intersection not found");
        
        uint256 length = signalAdjustments[intersectionId].length;
        newDurations = new uint256[](length);
        adjusters = new address[](length);
        timestamps = new uint256[](length);
        
        for (uint256 i = 0; i < length; i++) {
            newDurations[i] = signalAdjustments[intersectionId][i].newDuration;
            adjusters[i] = signalAdjustments[intersectionId][i].adjuster;
            timestamps[i] = signalAdjustments[intersectionId][i].timestamp;
        }
        
        return (newDurations, adjusters, timestamps);
    }

    function getAllIntersectionIds() external view returns (string[] memory) {
        return intersectionIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}