package com.threexdezine.android.render

import com.google.android.filament.Box
import com.google.android.filament.Engine
import com.google.android.filament.EntityManager
import com.google.android.filament.IndexBuffer
import com.google.android.filament.MaterialInstance
import com.google.android.filament.RenderableManager
import com.google.android.filament.Scene
import com.google.android.filament.VertexBuffer
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * One Filament renderable built from a [MeshData], plus the buffers it owns.
 *
 * LIFECYCLE: Filament leaks natively if resources outlive the Engine. SceneView only
 * manages what SceneView created — everything here is ours, so [destroy] must run
 * before the Engine goes away. [SceneController] does that from a DisposableEffect.
 */
class FilamentMesh private constructor(
    val ref: SurfaceRef,
    @Suppress("MemberVisibilityCanBePrivate") val entity: Int,
    private val vertexBuffer: VertexBuffer,
    private val indexBuffer: IndexBuffer,
) {

    private var destroyed = false

    /** Re-binds the primitive's material. This is the "instant material swap" path. */
    fun setMaterial(engine: Engine, instance: MaterialInstance) {
        if (destroyed) return
        val rm = engine.renderableManager
        val ri = rm.getInstance(entity)
        if (ri != 0) rm.setMaterialInstanceAt(ri, 0, instance)
    }

    fun setShadows(engine: Engine, cast: Boolean, receive: Boolean) {
        if (destroyed) return
        val rm = engine.renderableManager
        val ri = rm.getInstance(entity)
        if (ri != 0) {
            rm.setCastShadows(ri, cast)
            rm.setReceiveShadows(ri, receive)
        }
    }

    fun destroy(engine: Engine, scene: Scene) {
        if (destroyed) return
        destroyed = true
        scene.removeEntity(entity)
        engine.renderableManager.destroy(entity)
        engine.destroyVertexBuffer(vertexBuffer)
        engine.destroyIndexBuffer(indexBuffer)
        engine.destroyEntity(entity)
        EntityManager.get().destroy(entity)
    }

    companion object {

        /**
         * Uploads [mesh] and adds the renderable to [scene].
         *
         * Attributes are laid out one per buffer (POSITION float3, TANGENTS float4,
         * UV0 float2) rather than interleaved: it costs a little locality and buys a
         * layout that is obvious to read and impossible to get the strides wrong in.
         */
        fun create(
            engine: Engine,
            scene: Scene,
            ref: SurfaceRef,
            mesh: MeshData,
            material: MaterialInstance,
            castShadows: Boolean = true,
            receiveShadows: Boolean = true,
        ): FilamentMesh? {
            if (mesh.isEmpty) return null
            val vertexCount = mesh.vertexCount

            val vertexBuffer = VertexBuffer.Builder()
                .bufferCount(3)
                .vertexCount(vertexCount)
                .attribute(
                    VertexBuffer.VertexAttribute.POSITION, 0,
                    VertexBuffer.AttributeType.FLOAT3, 0, 3 * 4,
                )
                .attribute(
                    VertexBuffer.VertexAttribute.TANGENTS, 1,
                    VertexBuffer.AttributeType.FLOAT4, 0, 4 * 4,
                )
                .attribute(
                    VertexBuffer.VertexAttribute.UV0, 2,
                    VertexBuffer.AttributeType.FLOAT2, 0, 2 * 4,
                )
                .build(engine)

            vertexBuffer.setBufferAt(engine, 0, mesh.positions.toDirectBuffer())
            vertexBuffer.setBufferAt(engine, 1, mesh.tangents.toDirectBuffer())
            vertexBuffer.setBufferAt(engine, 2, mesh.uvs.toDirectBuffer())

            val indexBuffer = IndexBuffer.Builder()
                .indexCount(mesh.indices.size)
                .bufferType(IndexBuffer.Builder.IndexType.UINT)
                .build(engine)
            indexBuffer.setBuffer(engine, mesh.indices.toDirectBuffer())

            val cx = (mesh.minX + mesh.maxX) * 0.5f
            val cy = (mesh.minY + mesh.maxY) * 0.5f
            val cz = (mesh.minZ + mesh.maxZ) * 0.5f
            // A non-zero half extent everywhere: a perfectly flat slab with a 0 extent
            // on one axis culls unpredictably.
            val hx = ((mesh.maxX - mesh.minX) * 0.5f).coerceAtLeast(0.001f)
            val hy = ((mesh.maxY - mesh.minY) * 0.5f).coerceAtLeast(0.001f)
            val hz = ((mesh.maxZ - mesh.minZ) * 0.5f).coerceAtLeast(0.001f)

            val entity = EntityManager.get().create()
            RenderableManager.Builder(1)
                .boundingBox(Box(cx, cy, cz, hx, hy, hz))
                .geometry(0, RenderableManager.PrimitiveType.TRIANGLES, vertexBuffer, indexBuffer)
                .material(0, material)
                .castShadows(castShadows)
                .receiveShadows(receiveShadows)
                .culling(true)
                .build(engine, entity)

            scene.addEntity(entity)
            return FilamentMesh(ref, entity, vertexBuffer, indexBuffer)
        }

        private fun FloatArray.toDirectBuffer(): ByteBuffer {
            val bb = ByteBuffer.allocateDirect(size * 4).order(ByteOrder.nativeOrder())
            bb.asFloatBuffer().put(this)
            bb.rewind()
            return bb
        }

        private fun IntArray.toDirectBuffer(): ByteBuffer {
            val bb = ByteBuffer.allocateDirect(size * 4).order(ByteOrder.nativeOrder())
            bb.asIntBuffer().put(this)
            bb.rewind()
            return bb
        }
    }
}
