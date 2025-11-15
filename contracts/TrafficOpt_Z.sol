pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TrafficOptimization is ZamaEthereumConfig {
    struct TrafficData {
        euint32 encryptedSpeed;
        euint32 encryptedPosition;
        uint256 publicTimestamp;
        address vehicleAddress;
        uint32 decryptedSpeed;
        uint32 decryptedPosition;
        bool isVerified;
    }

    struct SignalData {
        euint32 encryptedCycleTime;
        uint256 publicLocation;
        address controller;
        uint32 decryptedCycleTime;
        bool isVerified;
    }

    mapping(string => TrafficData) public trafficEntries;
    mapping(string => SignalData) public signalControllers;
    string[] public trafficIds;
    string[] public signalIds;

    event TrafficDataSubmitted(string indexed vehicleId, address indexed sender);
    event SignalDataSubmitted(string indexed signalId, address indexed controller);
    event TrafficDecryptionVerified(string indexed vehicleId, uint32 speed, uint32 position);
    event SignalDecryptionVerified(string indexed signalId, uint32 cycleTime);

    constructor() ZamaEthereumConfig() {}

    function submitTrafficData(
        string calldata vehicleId,
        externalEuint32 encryptedSpeed,
        bytes calldata speedProof,
        externalEuint32 encryptedPosition,
        bytes calldata positionProof
    ) external {
        require(bytes(trafficEntries[vehicleId].vehicleAddress).length == 0, "Vehicle data exists");

        euint32 speed = FHE.fromExternal(encryptedSpeed, speedProof);
        euint32 position = FHE.fromExternal(encryptedPosition, positionProof);

        require(FHE.isInitialized(speed), "Invalid encrypted speed");
        require(FHE.isInitialized(position), "Invalid encrypted position");

        trafficEntries[vehicleId] = TrafficData({
            encryptedSpeed: speed,
            encryptedPosition: position,
            publicTimestamp: block.timestamp,
            vehicleAddress: msg.sender,
            decryptedSpeed: 0,
            decryptedPosition: 0,
            isVerified: false
        });

        FHE.allowThis(speed);
        FHE.allowThis(position);
        FHE.makePubliclyDecryptable(speed);
        FHE.makePubliclyDecryptable(position);

        trafficIds.push(vehicleId);
        emit TrafficDataSubmitted(vehicleId, msg.sender);
    }

    function submitSignalData(
        string calldata signalId,
        externalEuint32 encryptedCycleTime,
        bytes calldata cycleProof,
        uint256 location
    ) external {
        require(bytes(signalControllers[signalId].controller).length == 0, "Signal data exists");

        euint32 cycleTime = FHE.fromExternal(encryptedCycleTime, cycleProof);
        require(FHE.isInitialized(cycleTime), "Invalid encrypted cycle time");

        signalControllers[signalId] = SignalData({
            encryptedCycleTime: cycleTime,
            publicLocation: location,
            controller: msg.sender,
            decryptedCycleTime: 0,
            isVerified: false
        });

        FHE.allowThis(cycleTime);
        FHE.makePubliclyDecryptable(cycleTime);

        signalIds.push(signalId);
        emit SignalDataSubmitted(signalId, msg.sender);
    }

    function verifyTrafficDecryption(
        string calldata vehicleId,
        bytes memory speedAbiEncoded,
        bytes memory speedProof,
        bytes memory positionAbiEncoded,
        bytes memory positionProof
    ) external {
        require(bytes(trafficEntries[vehicleId].vehicleAddress).length > 0, "Vehicle data missing");
        require(!trafficEntries[vehicleId].isVerified, "Data already verified");

        bytes32[] memory speedCts = new bytes32[](1);
        speedCts[0] = FHE.toBytes32(trafficEntries[vehicleId].encryptedSpeed);
        FHE.checkSignatures(speedCts, speedAbiEncoded, speedProof);

        bytes32[] memory positionCts = new bytes32[](1);
        positionCts[0] = FHE.toBytes32(trafficEntries[vehicleId].encryptedPosition);
        FHE.checkSignatures(positionCts, positionAbiEncoded, positionProof);

        uint32 decodedSpeed = abi.decode(speedAbiEncoded, (uint32));
        uint32 decodedPosition = abi.decode(positionAbiEncoded, (uint32));

        trafficEntries[vehicleId].decryptedSpeed = decodedSpeed;
        trafficEntries[vehicleId].decryptedPosition = decodedPosition;
        trafficEntries[vehicleId].isVerified = true;

        emit TrafficDecryptionVerified(vehicleId, decodedSpeed, decodedPosition);
    }

    function verifySignalDecryption(
        string calldata signalId,
        bytes memory cycleAbiEncoded,
        bytes memory cycleProof
    ) external {
        require(bytes(signalControllers[signalId].controller).length > 0, "Signal data missing");
        require(!signalControllers[signalId].isVerified, "Data already verified");

        bytes32[] memory cycleCts = new bytes32[](1);
        cycleCts[0] = FHE.toBytes32(signalControllers[signalId].encryptedCycleTime);
        FHE.checkSignatures(cycleCts, cycleAbiEncoded, cycleProof);

        uint32 decodedCycle = abi.decode(cycleAbiEncoded, (uint32));

        signalControllers[signalId].decryptedCycleTime = decodedCycle;
        signalControllers[signalId].isVerified = true;

        emit SignalDecryptionVerified(signalId, decodedCycle);
    }

    function getTrafficData(string calldata vehicleId) external view returns (
        uint256 timestamp,
        address vehicleAddress,
        bool isVerified,
        uint32 decryptedSpeed,
        uint32 decryptedPosition
    ) {
        require(bytes(trafficEntries[vehicleId].vehicleAddress).length > 0, "Vehicle data missing");
        TrafficData storage data = trafficEntries[vehicleId];
        return (
            data.publicTimestamp,
            data.vehicleAddress,
            data.isVerified,
            data.decryptedSpeed,
            data.decryptedPosition
        );
    }

    function getSignalData(string calldata signalId) external view returns (
        uint256 location,
        address controller,
        bool isVerified,
        uint32 decryptedCycleTime
    ) {
        require(bytes(signalControllers[signalId].controller).length > 0, "Signal data missing");
        SignalData storage data = signalControllers[signalId];
        return (
            data.publicLocation,
            data.controller,
            data.isVerified,
            data.decryptedCycleTime
        );
    }

    function getAllTrafficIds() external view returns (string[] memory) {
        return trafficIds;
    }

    function getAllSignalIds() external view returns (string[] memory) {
        return signalIds;
    }

    function systemStatus() public pure returns (bool) {
        return true;
    }
}


